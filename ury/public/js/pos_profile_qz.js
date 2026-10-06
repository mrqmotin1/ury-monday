// Fills the POS Profile "POS Printer" (custom_qz_printer) Select with the printers
// QZ Tray reports on the profile's QZ Host.
//
// Frappe concatenates every installed app's doctype_js for a doctype into ONE
// function body, so a top-level name shared with another app is a SyntaxError
// that kills every form script in it. Keep everything private.
(() => {
	let certificatePem; // undefined = not fetched yet, null = not configured

	function getCertificate() {
		if (certificatePem !== undefined) return Promise.resolve(certificatePem);
		return frappe
			.call({ method: "ury.ury.api.ury_print.qz_certificate_pem" })
			.then((r) => (certificatePem = r.message || null))
			.catch(() => (certificatePem = null));
	}

	function configureSecurity() {
		// Same trust setup as the POS: certificate + signing come from the server,
		// the private key never reaches the browser. No certificate -> anonymous mode.
		qz.security.setCertificatePromise((resolve) => {
			getCertificate().then((cert) => resolve(cert || undefined));
		});
		qz.security.setSignatureAlgorithm("SHA512");
		qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
			getCertificate().then((cert) => {
				if (!cert) return resolve();
				frappe
					.call({ method: "ury.ury.api.ury_print.signature_promise", args: { toSign } })
					.then((r) => (r.message ? resolve(r.message) : reject("No signature returned")))
					.catch(reject);
			});
		});
	}

	async function connect(host) {
		await frappe.require("/assets/ury/js/qz-tray.js");
		configureSecurity();
		if (qz.websocket.isActive()) {
			if (window.__ury_qz_host === host) return;
			await qz.websocket.disconnect();
		}
		await qz.websocket.connect({ host, usingSecure: window.location.protocol === "https:" });
		window.__ury_qz_host = host;
	}

	function setPrinterOptions(frm, printers) {
		const current = frm.doc.custom_qz_printer;
		const options = ["", ...printers];
		// Keep a saved printer selectable even when this PC doesn't have it.
		if (current && !printers.includes(current)) options.push(current);
		frm.set_df_property("custom_qz_printer", "options", options.join("\n"));
		frm.refresh_field("custom_qz_printer");
	}

	async function loadPrinters(frm, { notify = false } = {}) {
		if (!frm.doc.qz_print) return;
		const host = frm.doc.qz_host || "localhost";
		try {
			await connect(host);
			const found = await qz.printers.find();
			const printers = Array.isArray(found) ? found : [found].filter(Boolean);
			setPrinterOptions(frm, printers);
			if (notify) {
				frappe.show_alert({
					message: __("{0} printer(s) found on {1}", [printers.length, host]),
					indicator: "green",
				});
			}
		} catch (err) {
			console.error("QZ printer lookup failed", err);
			setPrinterOptions(frm, []);
			frm.dashboard.set_headline_alert(
				__("QZ Tray is not reachable on {0}. Start QZ Tray there to list printers.", [host]),
				"orange"
			);
		}
	}

	frappe.ui.form.on("POS Profile", {
		refresh(frm) {
			if (!frm.doc.qz_print) return;
			frm.add_custom_button(__("Refresh QZ Printers"), () => loadPrinters(frm, { notify: true }));
			loadPrinters(frm);
		},
		qz_print(frm) {
			loadPrinters(frm);
		},
		qz_host(frm) {
			loadPrinters(frm);
		},
	});
})();
