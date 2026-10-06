frappe.require([
    '/assets/ury/js/qz-tray.js',
    '/assets/ury/js/jsrsasign-all-min.js',
    '/assets/ury/js/sign-message.js'
]);

// QZ Tray printing for the desk POS Invoice form. Mirrors the React POS
// (@ury/core print/qz.ts): server-side certificate + signing, POS Profile
// printer, and raw ESC/POS output when the print format has Raw Printing on.
var uryQzCertificate; // undefined = not fetched yet, null = not configured

function uryQzGetCertificate() {
    if (uryQzCertificate !== undefined) return Promise.resolve(uryQzCertificate);
    return frappe.call({ method: "ury.ury.api.ury_print.qz_certificate_pem" })
        .then((r) => (uryQzCertificate = r.message || null))
        .catch(() => (uryQzCertificate = null));
}

function uryQzConfigureSecurity() {
    qz.security.setCertificatePromise((resolve) => {
        uryQzGetCertificate().then((cert) => resolve(cert || undefined));
    });
    qz.security.setSignatureAlgorithm("SHA512");
    qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
        uryQzGetCertificate().then((cert) => {
            if (!cert) return resolve();
            frappe.call({ method: "ury.ury.api.ury_print.signature_promise", args: { toSign: toSign } })
                .then((r) => (r.message ? resolve(r.message) : reject("No signature returned")))
                .catch(reject);
        });
    });
}

async function printInvoiceWithQz(invoice, profile) {
    const host = profile.qz_host || "localhost";
    uryQzConfigureSecurity();
    if (qz.websocket.isActive() && window.__ury_qz_host !== host) {
        await qz.websocket.disconnect();
    }
    if (!qz.websocket.isActive()) {
        await qz.websocket.connect({ host: host, usingSecure: window.location.protocol === "https:" });
        window.__ury_qz_host = host;
    }

    let printer;
    if (profile.custom_qz_printer) {
        const found = await qz.printers.find();
        const printers = Array.isArray(found) ? found : [found].filter(Boolean);
        printer = printers.find((p) => p === profile.custom_qz_printer)
            || printers.find((p) => p.toLowerCase() === profile.custom_qz_printer.toLowerCase());
        if (!printer) {
            throw new Error(__("Printer {0} not found on {1}. Available: {2}",
                [profile.custom_qz_printer, host, printers.join(", ") || __("none")]));
        }
    } else {
        printer = await qz.printers.getDefault();
    }

    const r = await frappe.call({
        method: "ury.ury.api.ury_print.get_qz_print_data",
        args: { doctype: "POS Invoice", name: invoice, print_format: profile.print_format },
    });
    const payload = r.message || {};
    if (!payload.data) throw new Error(__("Nothing to print"));

    if (payload.type === "raw") {
        const config = qz.configs.create(printer, { forceRaw: true });
        return qz.print(config, [{ type: "raw", format: "command", flavor: "plain", data: payload.data }]);
    }
    const config = qz.configs.create(printer);
    return qz.print(config, [{ type: "html", format: "plain", data: payload.data }]);
}

async function updateMergedInvoicePrint(invoice) {

    await frappe.call({
        method: "ury.ury.api.ury_print.qz_print_update",
        args: {
            invoice: invoice,
        },
    });

    await frappe.call({
        method:
            "ury.ury.doctype.ury_order.ury_order.release_tables_after_print",
        args: {
            invoice: invoice,
        },
    });

    cur_frm.set_value(
        "invoice_printed",
        1,
    );

    cur_frm.reload_doc();

    frappe.show_alert({
        message: __("Invoice Printed"),
        indicator: "green",
    });
}

frappe.ui.form.on('POS Invoice', {

    before_save: function (frm) {
        if (frm.doc.customer_name === null || frm.doc.customer_name === "") {
            frappe.throw({
                message: __("Failed to load data . Please refresh the page")
            });
        }
    },

    print: function (frm) {
        let invoice = frm.doc.name
        frappe.db.get_doc('POS Invoice', invoice).then(pos_invoice => {
            if (pos_invoice.invoice_printed == 1) {
                frappe.throw({
                    title: __("Invoice Already Billed"),
                    message: __("This order has already been billed. Please reload the page."),
                    indicator: 'red'
                });
            }
            frappe.dom.freeze(__('Printing Invoice'));
            frappe.db.get_doc('POS Profile', frm.doc.pos_profile).then(profile => {

                if (profile.qz_print == 1) {
                    printInvoiceWithQz(invoice, profile)
                        .then(function () {
                            frappe.call({
                                method: `ury.ury.api.ury_print.qz_print_update`,
                                args: {
                                    invoice: invoice
                                },
                                callback: function (r) {
                                }
                            });
                            updateMergedInvoicePrint(invoice);
                            frappe.dom.unfreeze();
                            frappe.show_alert({ message: __('Invoice Printed'), indicator: 'green' });
                        })
                        .catch(function (error) {
                            console.error("Error printing with QZ Tray:", error);
                            frappe.dom.unfreeze();
                            frappe.throw({
                                message: __("Printing Failed: {0}", [error && error.message ? error.message : error])
                            });
                        });
                }
                else if (profile.printer_settings.some(e => e.bill == 1)) {
                    profile.printer_settings.forEach(print => {
                        frappe.call({
                            method: `ury.ury.api.ury_print.network_printing`,
                            args: {
                                doctype: "POS Invoice",
                                name: invoice,
                                printer_setting: print.printer,
                                print_format: profile.print_format
                            },
                            callback: function (r) {
                                if (r.message == "Success") {
                                    $('.standard-actions').addClass('hidden-xs hidden-md');
                                    frappe.show_alert({ message: __('Invoice Printed'), indicator: 'green' });
                                    updateMergedInvoicePrint(invoice);
                                    frappe.dom.unfreeze();
                                    cur_frm.reload_doc();
                                }
                                else {
                                    console.error(r.message);
                                    frappe.dom.unfreeze();
                                    frappe.throw({
                                        message: __("Printing Failed")
                                    });
                                }
                            },
                            error: function (xhr, textStatus, error) {
                                console.error("AJAX Error:", error); // Log the AJAX error
                                frappe.dom.unfreeze();
                                frappe.throw({
                                    message: __("An error occurred while printing")
                                });
                            }
                        })
                    })
                }
                else {
                    frappe.call({
                        method: `ury.ury.api.ury_print.print_pos_page`,
                        args: {
                            doctype: "POS Invoice",
                            name: invoice,
                            print_format: profile.print_format
                        },
                        callback: function (r) {
                            $('.standard-actions').addClass('hidden-xs hidden-md');
                            updateMergedInvoicePrint(invoice);
                            frappe.show_alert({ message: __('Invoice Printed'), indicator: 'green' });
                            frappe.ui.toolbar.clear_cache()
                            frappe.dom.unfreeze();
                        }
                    });
                }
            })
        })
    }

})

