"""QZ Tray print jobs for server-created documents (KOT, waiter slip, KOT reprint).

QZ Tray runs next to the printer, so the server cannot print to it directly.
When a POS Profile has QZ Print on, the server renders the document, keeps the
output in cache for a few minutes and broadcasts a job id on
``qz_print_<branch>``. Every open POS of that branch listens; the first one
that can reach QZ claims the job (atomic Redis lock) and prints it on the POS
Profile's POS Printer. Unclaimed jobs expire and are dropped.
"""

import frappe
from frappe import _

JOB_TTL_SECONDS = 300
DEFAULT_QZ_KOT_PRINT_FORMAT = "URY KOT (Raw)"

QZ_PRINT_ROLES = {
	"Administrator",
	"System Manager",
	"URY Manager",
	"URY Cashier",
	"URY Captain",
}


def is_qz_profile(pos_profile):
	return bool(pos_profile and frappe.db.get_value("POS Profile", pos_profile, "qz_print"))


def render_qz_print_data(doc, print_format=None):
	"""Render `doc` with `print_format`: raw commands when the format has
	"Raw Printing" checked, else HTML. Returns {"type", "data"}."""
	from frappe.www.printview import get_print_format_doc, get_rendered_template

	print_format_doc = get_print_format_doc(print_format, meta=doc.meta)
	if print_format_doc and print_format_doc.raw_printing:
		data = get_rendered_template(doc=doc, print_format=print_format_doc, meta=doc.meta)
		return {"type": "raw", "data": data or ""}

	html = get_rendered_template(
		doc=doc,
		print_format=print_format_doc,
		meta=doc.meta,
		no_letterhead=1,
		letterhead="No Letterhead",
	)
	return {"type": "html", "data": html or ""}


def _job_key(job_id):
	return f"ury_qz_print_job:{job_id}"


def _claim_key(job_id):
	return frappe.cache().make_key(f"ury_qz_print_claim:{job_id}")


def queue_qz_print(pos_profile, doc, print_format, kind, title=None):
	"""Render `doc` now and broadcast it as a QZ job to the profile's branch.

	Returns the job id, or None when nothing was rendered. Never raises: a
	print problem must not block saving the order."""
	ignore_print_permissions = frappe.flags.ignore_print_permissions
	try:
		branch = frappe.db.get_value("POS Profile", pos_profile, "branch")
		# Server-created job (KOT / slip on order save): the user saving the
		# order need not hold Print permission on URY KOT.
		frappe.flags.ignore_print_permissions = True
		payload = render_qz_print_data(doc, print_format)
		if not payload["data"]:
			return None

		job_id = frappe.generate_hash(length=16)
		frappe.cache().set_value(
			_job_key(job_id),
			{
				**payload,
				"kind": kind,
				"title": title or doc.name,
				"branch": branch,
				"pos_profile": pos_profile,
			},
			expires_in_sec=JOB_TTL_SECONDS,
		)
		frappe.publish_realtime(
			f"qz_print_{branch}",
			{"job_id": job_id, "kind": kind, "title": title or doc.name, "pos_profile": pos_profile},
			after_commit=True,
		)
		return job_id
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"URY QZ {kind} print job failed")
		return None
	finally:
		frappe.flags.ignore_print_permissions = ignore_print_permissions


def _check_claim_access(job):
	roles = set(frappe.get_roles())
	if frappe.session.user == "Guest" or not QZ_PRINT_ROLES.intersection(roles):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if frappe.session.user == "Administrator" or "System Manager" in roles:
		return

	from ury.ury_pos.api import getBranch

	if getBranch() != job.get("branch"):
		frappe.throw(_("Not permitted to print jobs of another branch"), frappe.PermissionError)


@frappe.whitelist()
def claim_qz_print_job(job_id):
	"""Claim a job for printing. Returns the payload to the first caller only;
	later callers (other open POS screens) get None."""
	job = frappe.cache().get_value(_job_key(job_id))
	if not job:
		return None

	_check_claim_access(job)

	if not frappe.cache().set(_claim_key(job_id), frappe.session.user, nx=True, ex=JOB_TTL_SECONDS):
		return None
	return job


@frappe.whitelist()
def release_qz_print_job(job_id):
	"""Give a claimed job back (this POS could not print it) so another open POS can."""
	job = frappe.cache().get_value(_job_key(job_id))
	if not job:
		return
	_check_claim_access(job)
	frappe.cache().delete(_claim_key(job_id))
	frappe.publish_realtime(
		f"qz_print_{job['branch']}",
		{"job_id": job_id, "kind": job["kind"], "title": job["title"], "pos_profile": job["pos_profile"], "retry": 1},
	)
