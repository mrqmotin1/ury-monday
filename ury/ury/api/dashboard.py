import frappe
from frappe.utils import today

def _branch_filter(branch):
    """'all' / empty means every branch; otherwise filter on the Branch name."""
    return branch if branch and branch != 'all' else None


@frappe.whitelist()
def get_dashboard_summary(branch=None):
    from ury.ury.report_api.sales import get_today_sales
    from ury.ury.report_api.utils import require_manager

    branch = _branch_filter(branch)
    branch_filters = {"branch": branch} if branch else {}

    today_sales = 0
    today_orders = 0
    avg_order_value = 0
    try:
        require_manager()
        # Same numbers as the Today's Sales report (incl. branch business-day hours).
        sales = get_today_sales(branch=branch)
        today_sales = sales.get("grand_total") or 0
        today_orders = sales.get("total_invoices") or 0
        avg_order_value = round(today_sales / today_orders, 2) if today_orders else 0
    except frappe.PermissionError:
        frappe.clear_last_message()

    pending_kitchen_orders = 0
    if frappe.db.exists("DocType", "URY KOT"):
        # Mirrors the KOT display's pending queue (ury_kot_display.py).
        pending_kitchen_orders = frappe.db.count("URY KOT", {
            **branch_filters,
            "order_status": "Ready For Prepare",
            "type": ["in", ["New Order", "Order Modified", "Duplicate", "Cancelled", "Partially cancelled"]],
            "docstatus": 1,
            "verified": 0,
            "creation": [">=", frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-3)],
        })

    has_tables = frappe.db.exists("DocType", "URY Table")
    return {
        "today_sales": today_sales,
        "today_orders": today_orders,
        "occupied_tables": frappe.db.count("URY Table", {**branch_filters, "occupied": 1}) if has_tables else 0,
        "total_tables": frappe.db.count("URY Table", branch_filters) if has_tables else 0,
        "avg_order_value": avg_order_value,
        "active_cashiers": frappe.db.count("User", {"enabled": 1}),
        "pending_kitchen_orders": pending_kitchen_orders,
        "total_menu_items": frappe.db.count("Item") if frappe.db.exists("DocType", "Item") else 0,
    }

@frappe.whitelist()
def get_dashboard_charts(branch=None):
    return {
        "sales_trend": [],
        "hourly_sales": [],
        "payment_methods": [],
        "order_types": [],
        "top_items": [],
        "revenue_by_branch": [],
        "sales_by_course": [],
    }

@frappe.whitelist()
def get_recent_transactions(branch=None, limit=10):
    filters = {"docstatus": ["in", [0, 1]]}
    branch = _branch_filter(branch)
    if branch:
        filters["branch"] = branch
    
    if frappe.db.exists("DocType", "POS Invoice"):
        try:
            invoices = frappe.get_all("POS Invoice", 
                filters=filters,
                fields=["name", "customer", "posting_date", "posting_time", "grand_total", "status", "order_type", "restaurant_table as restaurant_table", "owner as cashier"],
                order_by="creation desc",
                limit=int(limit)
            )
            for inv in invoices:
                if not inv.get("status"):
                    inv["status"] = "Draft" if inv.get("docstatus") == 0 else "Paid"
                if not inv.get("order_type"):
                    inv["order_type"] = "Dine In"
            return invoices
        except Exception as e:
            frappe.log_error(f"Error in get_recent_transactions: {str(e)}")
            return []
    return []

@frappe.whitelist()
def get_module_records(doctype, branch=None):
    if not frappe.db.exists("DocType", doctype):
        return []
    
    filters = {}
    if branch and branch != 'all':
        meta = frappe.get_meta(doctype)
        if meta.has_field("branch"):
            filters["branch"] = branch
        elif meta.has_field("custom_branch"):
            filters["custom_branch"] = branch
            
    try:
        records = frappe.get_all(doctype, filters=filters, fields=["*"])
        if doctype == "User":
            for r in records:
                r["roles"] = frappe.get_all("Has Role", filters={"parent": r.name}, fields=["role"])
        return records
    except Exception:
        return []
