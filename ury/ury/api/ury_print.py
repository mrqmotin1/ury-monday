import frappe
from frappe import _

import base64
import os

from pypdf import PdfWriter
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from ury.ury.doctype.ury_order.ury_order import release_merge_cluster_tables

no_cache = 1

base_template_path = "www/printview.html"
standard_format = "templates/print_formats/standard.html"

from frappe.www.printview import validate_print_permission


@frappe.whitelist()
def network_printing(
    doctype,
    name,
    printer_setting,
    print_format=None,
    doc=None,
    no_letterhead=0,
):
    validate_print_permission(frappe.get_doc(doctype, name))

    try:
        print_settings = frappe.get_doc("Network Printer Settings", printer_setting)

        try:
            import cups
        except ImportError:
            return "Failed to import cups"

        try:
            cups.setServer(print_settings.server_ip)
            cups.setPort(print_settings.port)
            conn = cups.Connection()
        except Exception as e:
            return f"Failed to connect to the printer: {str(e)}"

        try:
            output = PdfWriter()
            output = frappe.get_print(
                doctype,
                name,
                print_format,
                doc=doc,
                no_letterhead=no_letterhead,
                as_pdf=True,
                output=output,
            )
            file_path = os.path.join(
                "/", "tmp", f"frappe-pdf-{frappe.generate_hash()}.pdf"
            )
            try:
                with open(file_path, "wb") as f:
                    output.write(f)
                conn.printFile(print_settings.printer_name, file_path, name, {})

                restaurant_table, invoice_printed, name = frappe.db.get_value(
                    "POS Invoice", name, ["restaurant_table", "invoice_printed", "name"]
                )

                if restaurant_table and invoice_printed == 0:
                    frappe.db.set_value("POS Invoice", name, "invoice_printed", 1)
                    release_merge_cluster_tables(restaurant_table)
                else:
                    frappe.db.set_value("POS Invoice", name, "invoice_printed", 1)

                return "Success"
            finally:
                if os.path.exists(file_path):
                    os.remove(file_path)
        except Exception as e:
            return f"Failed to print: {str(e)}"
    except Exception as e:
        import traceback

        traceback.print_exc()  # Print the full traceback for debugging
        return f"An error occurred: {str(e)}"


@frappe.whitelist()
def select_network_printer(pos_profile, invoice_id):
    invoice_doc = frappe.get_doc("POS Invoice", invoice_id)
    if not frappe.has_permission("POS Invoice", "write", doc=invoice_doc):
        frappe.throw(_("Not permitted to print this invoice"), frappe.PermissionError)

    table = frappe.db.get_value("POS Invoice", invoice_id, "restaurant_table")
    print_format = frappe.db.get_value("POS Profile", pos_profile, "print_format")

    if table:
        room = frappe.db.get_value("URY Table", table, "restaurant_room")
        room_bill_printers = frappe.get_all(
            "URY Printer Settings",
            filters={"parent": room, "parenttype": "URY Room", "bill": 1},
            pluck="printer",
            order_by="idx"
        )
        if room_bill_printers:
            for printer in room_bill_printers:
                print = network_printing(
                    "POS Invoice", invoice_id, printer, print_format
                )
            return print

    else:
        pos_bill_printers = frappe.get_all(
            "URY Printer Settings",
            filters={"parent": pos_profile, "parenttype": "POS Profile", "bill": 1},
            pluck="printer",
            order_by="idx"
        )
        if pos_bill_printers:
            for printer in pos_bill_printers:
                print = network_printing(
                    "POS Invoice", invoice_id, printer, print_format
                )
            return print


@frappe.whitelist()
def qz_print_update(invoice):
    try:
        invoice_doc = frappe.get_doc("POS Invoice", invoice)
        if not frappe.has_permission("POS Invoice", "write", doc=invoice_doc):
            frappe.throw(_("Not permitted to print this invoice"), frappe.PermissionError)

        table = frappe.db.get_value("POS Invoice", invoice, "restaurant_table")
        
        if table == None or table == "":
            # Update invoice_printed
            frappe.db.set_value(
                "POS Invoice", invoice, "invoice_printed", 1, update_modified=False
            )
            
            # Validate the update
            new_invoice_printed = frappe.db.get_value("POS Invoice", invoice, "invoice_printed")
            if new_invoice_printed != 1:
                return {"status": "Failure"}                
        else:
            invoice_printed = frappe.db.get_value("POS Invoice", invoice, "invoice_printed")

            if invoice_printed == 0:
                # Update invoice_printed
                frappe.db.set_value(
                    "POS Invoice", invoice, "invoice_printed", 1, update_modified=False
                )

                release_merge_cluster_tables(table)
                # Validate both updates
                new_invoice_printed = frappe.db.get_value("POS Invoice", invoice, "invoice_printed")
                new_table_status = frappe.db.get_value("URY Table", table, "occupied")
                
                if new_invoice_printed != 1 or new_table_status != 0:
                    return {"status": "Failure"}
        
        return {"status": "Success"}
        
    except Exception as e:
        frappe.log_error(message=e, title="Print Fail")
        frappe.throw(_("Error while printing order",e))                   
        return {"status": "Failure"}


@frappe.whitelist()
def print_pos_page(doctype, name, print_format):
    doc_to_check = frappe.get_doc(doctype, name)
    if not frappe.has_permission(doctype, "write", doc=doc_to_check):
        frappe.throw(_("Not permitted to print this document"), frappe.PermissionError)

    data = {"name": name, "doctype": doctype, "print_format": print_format}

    restaurant_table, branch, name = frappe.db.get_value(
        "POS Invoice", name, ["restaurant_table", "branch", "name"]
    )
    print_channel = "{}_{}".format("print", branch)
    frappe.publish_realtime(print_channel, {"data": data})

    invoice_printed = frappe.db.get_value("POS Invoice", name, "invoice_printed")

    if invoice_printed == 0:
        frappe.db.set_value("POS Invoice", name, "invoice_printed", 1)

        if restaurant_table:
            release_merge_cluster_tables(restaurant_table)


@frappe.whitelist()
def qz_certificate():
    site_config = frappe.get_site_config()
    qz_key_value = site_config.get("qz_cert")

    return qz_key_value


@frappe.whitelist()
def qz_certificate_pem():
    """Public QZ certificate contents, or None when not configured (QZ then
    runs in anonymous mode and asks the user to Allow).

    Source: URY QZ Settings upload, else `qz_cert` in site_config.
    `qz_certificate` above returns only the raw config value; kept for
    backwards compatibility.
    """
    if frappe.session.user == "Guest":
        frappe.throw(_("Not permitted"), frappe.PermissionError)

    certificate = _read_qz_pem("certificate", "qz_cert")
    return certificate.decode() if certificate else None


@frappe.whitelist()
def get_qz_certificate_status():
    """Which QZ signing files are configured, and where they come from."""
    if frappe.session.user == "Guest":
        frappe.throw(_("Not permitted"), frappe.PermissionError)

    certificate_source = _qz_pem_source("certificate", "qz_cert")
    private_key_source = _qz_pem_source("private_key", "qz_private_key")
    return {
        "certificate": bool(certificate_source),
        "private_key": bool(private_key_source),
        "certificate_source": certificate_source,
        "private_key_source": private_key_source,
    }


@frappe.whitelist()
def get_qz_print_data(doctype, name, print_format=None):
    """Rendered print output for QZ Tray.

    A print format with "Raw Printing" checked renders its raw commands
    (ESC/POS) and is sent to the printer as-is; any other format renders HTML.
    Both helpers check read permission on the document.
    """
    from frappe.www.printview import get_html_and_style, get_rendered_raw_commands

    is_raw = bool(
        print_format
        and frappe.db.get_value("Print Format", print_format, "raw_printing")
    )

    if is_raw:
        rendered = get_rendered_raw_commands(doctype, name, print_format)
        return {"type": "raw", "data": rendered.get("raw_commands") or ""}

    rendered = get_html_and_style(
        doctype,
        name,
        print_format,
        no_letterhead=1,
        letterhead="No Letterhead",
    )
    return {"type": "html", "data": rendered.get("html") or ""}


# Roles allowed to request QZ Tray signatures. The private key never leaves
# the server; these users may only ask the server to sign a payload.
QZ_SIGNING_ROLES = {
    "Administrator",
    "System Manager",
    "URY Admin",
    "URY Manager",
    "URY Cashier",
    "URY Captain",
}


def _read_site_private_pem(config_key):
    """Read a PEM value from site_config.

    The config value may hold the PEM contents directly or a path relative to
    the site's `private` folder. Returns bytes, or None when the key is unset.
    """
    key_value = (frappe.get_site_config().get(config_key) or "").strip()

    if not key_value:
        return None

    if key_value.startswith("-----BEGIN"):
        return key_value.encode()

    private_root = os.path.abspath(frappe.get_site_path("private"))
    key_path = os.path.abspath(frappe.get_site_path("private", key_value))

    if os.path.commonpath([key_path, private_root]) != private_root:
        frappe.throw(_("Invalid {0} path in site config").format(config_key))

    with open(key_path, "rb") as key_file:
        return key_file.read()


def _read_qz_settings_file(fieldname):
    """Contents of a file attached to URY QZ Settings, or None."""
    if not frappe.db.exists("DocType", "URY QZ Settings"):
        return None

    file_url = frappe.db.get_single_value("URY QZ Settings", fieldname)
    if not file_url:
        return None

    file_name = frappe.db.get_value("File", {"file_url": file_url}, "name")
    if not file_name:
        return None

    content = frappe.get_doc("File", file_name).get_content()
    return content.encode() if isinstance(content, str) else content


# File names used by the mon-develop-3 apps (mondayposhyper / posawesome) when
# the files are dropped in via the File list instead of URY QZ Settings.
QZ_CONVENTION_FILES = {
    "certificate": ["/private/files/qz-certificate.txt", "/files/qz-certificate.txt"],
    "private_key": ["/private/files/qz-private-key.pem"],
}


def _read_qz_convention_file(settings_field):
    for file_url in QZ_CONVENTION_FILES.get(settings_field, []):
        file_name = frappe.db.get_value("File", {"file_url": file_url}, "name")
        if file_name:
            content = frappe.get_doc("File", file_name).get_content()
            return content.encode() if isinstance(content, str) else content
    return None


def _qz_pem_source(settings_field, config_key):
    """Where a QZ PEM comes from: 'settings', 'site_config', 'file_list' or None."""
    if _read_qz_settings_file(settings_field):
        return "settings"
    if (frappe.get_site_config().get(config_key) or "").strip():
        return "site_config"
    if _read_qz_convention_file(settings_field):
        return "file_list"
    return None


def _read_qz_pem(settings_field, config_key):
    """QZ PEM from, in order: URY QZ Settings upload, site_config, then the
    conventional File list names (qz-certificate.txt / qz-private-key.pem)."""
    return (
        _read_qz_settings_file(settings_field)
        or _read_site_private_pem(config_key)
        or _read_qz_convention_file(settings_field)
    )


def _get_qz_private_key():
    """Read the QZ private key server-side (never sent to the browser)."""
    private_key = _read_qz_pem("private_key", "qz_private_key")
    if not private_key:
        frappe.throw(_("QZ private key is not configured. Upload it in URY QZ Settings."))
    return private_key


@frappe.whitelist()
def signature_promise(toSign=None):
    """Server-side QZ Tray signing endpoint (sign-only)."""
    if frappe.session.user == "Guest":
        frappe.throw(_("Not permitted"), frappe.PermissionError)

    if not QZ_SIGNING_ROLES.intersection(frappe.get_roles()):
        frappe.throw(_("Not permitted"), frappe.PermissionError)

    if not toSign:
        frappe.throw(_("Missing payload to sign"))

    private_key = serialization.load_pem_private_key(
        _get_qz_private_key(), password=None
    )

    signature = private_key.sign(
        toSign.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA512(),
    )

    return base64.b64encode(signature).decode("ascii")
