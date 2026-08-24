"""
Shared CS payment line → Banana bill item conversion.

CS PAYMENTSLAVETABLE sometimes stores NetHkd as the unit net when qty > 1
(e.g. MINI SCREW qty=4, UnitAmountHkd=1000, NetHkd=1000). Old logic divided
net by qty → wrong unit price (250 instead of 1000).
"""
from __future__ import annotations


def fnum(v, default: float = 0.0) -> float:
    try:
        if v is None or v == "":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def cs_slave_row_to_bill_item(row: dict) -> dict | None:
    item = (row.get("Item") or row.get("item") or "").strip()
    sub = (row.get("SubItem") or row.get("sub_item") or "").strip()
    if not item and not sub:
        return None
    desc = item if not sub else (f"{item} - {sub}" if item else sub)

    qty = fnum(row.get("Qty") or row.get("qty"), 0.0)
    if qty <= 0:
        qty = 1.0

    net = fnum(row.get("NetHkd") or row.get("net_hkd"))
    disc_hkd = fnum(row.get("DiscountHkd") or row.get("discount_hkd"))
    unit_amt = fnum(row.get("UnitAmountHkd") or row.get("unit_amount_hkd"))

    line_from_unit = round(unit_amt * qty, 2) if unit_amt > 0 else 0.0
    line_from_net = round(net + disc_hkd, 2)

    if unit_amt > 0:
        unit_price = round(unit_amt, 2)
        if line_from_net > 0 and abs(line_from_net - line_from_unit) < 0.02:
            gross = line_from_unit
        elif (
            qty > 1
            and net > 0
            and abs(net - unit_amt) < 0.02
            and line_from_net + 0.02 < line_from_unit
        ):
            # NetHkd matches unit price, not line total — common CS quirk.
            gross = line_from_unit
        elif line_from_net > 0:
            gross = line_from_net
            unit_price = round(gross / qty, 2) if qty else round(gross, 2)
        else:
            gross = line_from_unit
    else:
        gross = line_from_net
        if gross <= 0 and net > 0:
            gross = net
        unit_price = round(gross / qty, 2) if qty else round(gross, 2)

    disc_pct = round((disc_hkd / gross) * 100.0, 4) if gross > 0 and disc_hkd > 0 else 0.0

    return {
        "desc": desc,
        "qty": qty if qty != int(qty) else int(qty),
        "price": unit_price,
        "disc": disc_pct,
        "tooth_no": "-",
    }


def cs_slave_row_to_bill_item_legacy(row: dict) -> dict | None:
    """Previous (buggy) conversion — for audit / finding affected rows."""
    item = (row.get("Item") or row.get("item") or "").strip()
    sub = (row.get("SubItem") or row.get("sub_item") or "").strip()
    if not item and not sub:
        return None
    desc = item if not sub else (f"{item} - {sub}" if item else sub)
    qty = fnum(row.get("Qty") or row.get("qty"), 0.0) or 1.0
    net = fnum(row.get("NetHkd") or row.get("net_hkd"))
    disc_hkd = fnum(row.get("DiscountHkd") or row.get("discount_hkd"))
    unit_amt = fnum(row.get("UnitAmountHkd") or row.get("unit_amount_hkd"))
    gross = net + disc_hkd
    if gross <= 0 and unit_amt > 0:
        gross = unit_amt
    if gross <= 0 and net > 0:
        gross = net
    unit_price = round(gross / qty, 2) if qty else round(gross, 2)
    disc_pct = round((disc_hkd / gross) * 100.0, 4) if gross > 0 and disc_hkd > 0 else 0.0
    return {
        "desc": desc,
        "qty": qty if qty != int(qty) else int(qty),
        "price": unit_price,
        "disc": disc_pct,
        "tooth_no": "-",
    }


def item_line_total(it: dict) -> float:
    qty = fnum(it.get("qty"), 1.0)
    price = fnum(it.get("price"))
    disc = fnum(it.get("disc"))
    gross = qty * price
    if disc > 0:
        return round(gross * (100.0 - disc) / 100.0, 2)
    return round(gross, 2)


def items_sum(items: list) -> float:
    return round(sum(item_line_total(it) for it in items), 2)


def reconcile_items_to_bill_total(items: list, bill_total: float) -> list | None:
    """
    Fix CS unit-price bug on stored items when line totals sum below bill.total.

    When CS stored NetHkd as unit net, import set price = net/qty. The true unit is
    price * qty; applying that to qty>1 lines often makes items sum match bill.total.
    """
    if not items or bill_total <= 0:
        return None

    target = round(bill_total, 2)
    current = items_sum(items)
    if abs(current - target) < 0.02:
        return None
    if current > target + 0.02:
        return None

    deficit = round(target - current, 2)
    fixed = [dict(it) for it in items]
    candidates: list[tuple[int, dict, float]] = []

    for i, it in enumerate(fixed):
        qty = fnum(it.get("qty"), 1.0)
        price = fnum(it.get("price"))
        if qty <= 1 or price <= 0:
            continue
        old_line = item_line_total(it)
        trial = dict(it)
        trial["price"] = round(price * qty, 2)
        gain = round(item_line_total(trial) - old_line, 2)
        if gain > 0.01:
            candidates.append((i, trial, gain))

    if not candidates:
        return None

    # Single-line fix (most common).
    for i, trial, gain in sorted(candidates, key=lambda x: -x[2]):
        if abs(gain - deficit) < 0.02:
            fixed[i] = trial
            if abs(items_sum(fixed) - target) < 0.02:
                return fixed

    # Multi-line greedy.
    remaining = deficit
    for i, trial, gain in sorted(candidates, key=lambda x: -x[2]):
        if gain <= remaining + 0.02:
            fixed[i] = trial
            remaining = round(remaining - gain, 2)
            if abs(remaining) < 0.02 and abs(items_sum(fixed) - target) < 0.02:
                return fixed

    return None
