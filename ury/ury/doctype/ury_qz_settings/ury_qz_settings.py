# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class URYQZSettings(Document):
	def validate(self):
		# Fail at upload time rather than on the first print.
		if self.certificate:
			content = self._get_private_file_content("certificate", _("QZ Certificate"))
			if not content.lstrip().startswith(b"-----BEGIN CERTIFICATE-----"):
				frappe.throw(_("QZ Certificate must be a PEM certificate (-----BEGIN CERTIFICATE-----)."))

		if self.private_key:
			content = self._get_private_file_content("private_key", _("QZ Private Key"))
			from cryptography.hazmat.primitives import serialization

			try:
				serialization.load_pem_private_key(content, password=None)
			except Exception:
				frappe.throw(_("QZ Private Key must be an unencrypted PEM private key."))

	def _get_private_file_content(self, fieldname, label):
		file_url = self.get(fieldname)
		file_doc = frappe.db.get_value(
			"File", {"file_url": file_url}, ["name", "is_private"], as_dict=True
		)
		if not file_doc:
			frappe.throw(_("{0}: file {1} not found.").format(label, file_url))
		if not file_doc.is_private:
			frappe.throw(_("{0} must be uploaded as a Private file.").format(label))

		content = frappe.get_doc("File", file_doc.name).get_content()
		return content.encode() if isinstance(content, str) else content
