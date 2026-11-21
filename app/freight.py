"""Transport-mode comparison with ESTIMATED freight prices. Pure functions: no network, no model.

For every supplier of the issue's material and every mode that has a route from that supplier's origin to the
DC in routes.csv, work out when the goods would arrive, whether that is before the last packing moment, and a
rough freight cost range. Nothing in the customer data states a freight price, so every cost here is an
estimate built from the market rates and assumptions in DEFAULTS (each with source and date), all editable
under the key "freight_estimate" in assumptions.json. See docs/FREIGHT.md.

Honesty rules: an estimate is never presented as customer data; an unknown part weight gives cost None;
arrival is "now + chain transit + handling", not a booking; a supplier inquiry is not a confirmed shipment.
"""
from __future__ import annotations

import copy
import csv
import statistics
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

from app.recovery import BERLIN

DC_SITE = 'DC-HAM'
LAUNCH_HOUR = 20  # launch is Sunday 22 Nov 2026 20:00 (challenge brief); only used when no packing deadline is known
PO_FILE = 'soony/erp/purchase_orders_2025H2-2026.csv'
LEGACY_PO_FILE = 'soony/erp/purchase_orders_legacy_2024-2025H1.csv'
DELIVERED_TERMS = ('DDP', 'DAP', 'DDU', 'CIF', 'CIP', 'CPT', 'CFR')
FOB_TERMS = ('FOB', 'EXW', 'FCA')

# Every default is an editable assumption or a cited market figure. Override any key via
# assumptions.json -> "freight_estimate" (deep merge). Dates are the as-of dates of the published figures.
DEFAULTS = {
    'usd_per_eur': 1.0989,  # ECB reference rate 17 Nov 2026 (via Banca d'Italia); usd_to_eur below is 1 / this, rounded
    'usd_to_eur': 0.9100,
    'packing_factor': 1.3,  # chargeable kg = actual kg x this (assumption: packaging and pallet allowance)
    'sea_payload_kg_per_40ft': 20000,  # assumption, used only to turn a per-container rate into a per-kg figure
    'air_rates_usd_per_kg': {
        'global': {
            'low': 3.11, 'base': 3.45, 'high': 5.175,
            'source': 'WorldACD weekly air cargo trends, week 45 (2-8 Nov 2026), global average, base; low from Xeneta global spot, Oct 2026; '
                      'high = base x 1.5, a stress buffer for urgent small lots (our assumption, not market data)'},
        'north_america': {
            'low': 1.15, 'base': 1.15, 'high': 2.875,
            'source': 'Xeneta North America to Europe backhaul corridor, Oct 2026, low and base; '
                      'high = base x 2.5, a stress buffer for urgent lots (our assumption, not market data)'},
    },
    'air_region_by_country': {'US': 'north_america', 'CA': 'north_america', 'MX': 'north_america'},  # any other country: global
    'sea_usd_per_40ft': {
        'value': 3496,
        'source': 'ShipUniverse summary of Drewry World Container Index, Shanghai to Rotterdam, 19 Nov 2026 (secondary source)'},
    'sea_high_factor': 1.5,  # high = base x this (stress buffer, our assumption)
    'road_eur_per_kg': {
        'low': 0.10, 'base': 0.15, 'high': 0.25,
        'source': 'Our assumption for the Poznan to Hamburg lane, no market source; confirm with Soony logistics'},
    'onward_truck_eur_per_kg': {
        'value': 0.05,
        'source': 'Our assumption for trucking from the port or airport to the DC (for example Frankfurt to Hamburg); confirm with Soony logistics'},
    'handling_days': {  # added once to the route transit days, by the mode of the first leg (assumptions)
        'air': {'first_mile': 1, 'customs_handling': 1},
        'sea': {'port_customs': 3},
        'road': {},
    },
    # Packed weight per unit in kg, matched by keyword against component description and category, first match wins.
    # Part weights are NOT in the customer data: every one is an assumption.
    'weights_kg': [
        ['steel case', 0.3], ['art book', 0.7], ['poster', 0.08], ['statue', 0.9], ["collector's box", 0.4],
        ['collector box', 0.4], ['sleeve', 0.005], ['leaflet', 0.005], ['case', 0.06], ['game card', 0.02],
    ],
    'weights_kg_by_material': {},  # {"<component id>": kg}, checked before the keywords
}

MODE_ORDER = ('air', 'sea', 'road')
MODE_WORD = {'air': 'Air freight', 'sea': 'Sea freight', 'road': 'Road freight'}


# ------------------------------------------------------------------ small helpers

def _rows(data_dir, relative):
    path = Path(data_dir) / relative
    if not path.exists():
        return []
    try:
        with path.open(encoding='utf-8-sig', newline='') as stream:
            return list(csv.DictReader(stream))
    except (OSError, csv.Error):
        return []


def _num(value):
    try:
        text = str(value).replace(',', '').strip()
        return float(text) if text else None
    except (TypeError, ValueError):
        return None


def _clean_number(value):
    """Round to 2 decimals; whole values stay ints for tidy JSON."""
    if value is None:
        return None
    value = round(float(value), 2)
    return int(value) if value == int(value) else value


def _days(value):
    value = round(float(value), 2)
    return int(value) if value == int(value) else value


def settings(assumptions):
    """DEFAULTS with the user's freight_estimate overrides deep-merged on top."""
    merged = copy.deepcopy(DEFAULTS)
    override = (assumptions or {}).get('freight_estimate') if isinstance(assumptions, dict) else None
    if isinstance(override, dict):
        _merge(merged, override)
    return merged


def _merge(base, override):
    for key, value in override.items():
        if str(key).startswith('_'):
            continue
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _merge(base[key], value)
        else:
            base[key] = value


def usd_to_eur(assumptions, cfg):
    """(rate, kind, source). freight_estimate.usd_to_eur wins, then fx_to_eur.USD, then the ECB default."""
    override = (assumptions or {}).get('freight_estimate') if isinstance(assumptions, dict) else None
    if isinstance(override, dict) and _num(override.get('usd_to_eur')):
        return float(_num(override['usd_to_eur'])), 'assumption', 'freight_estimate override in the assumptions file'
    fx = _num(((assumptions or {}).get('fx_to_eur') or {}).get('USD')) if isinstance(assumptions, dict) else None
    if fx and fx > 0:
        return fx, 'assumption', 'Exchange rate set in the assumptions file'
    return float(cfg['usd_to_eur']), 'market', 'ECB reference rate, 17 Nov 2026, 1 EUR = 1.0989 USD'


# ------------------------------------------------------------------ data discovery

def supplier_profiles(data_dir):
    """supplier_id -> {name, country, incoterm, currency} from the supplier folders."""
    found = {}
    root = Path(data_dir) / 'suppliers'
    if not root.is_dir():
        return found
    for folder in sorted(root.iterdir()):
        for row in _rows(data_dir, f'suppliers/{folder.name}/profile.csv')[:1]:
            sid = row.get('supplier_id')
            if sid:
                found[sid] = {'name': row.get('name') or sid, 'country': (row.get('country') or '').upper(),
                              'incoterm': row.get('incoterm') or '', 'currency': (row.get('currency') or '').upper(),
                              'folder': folder.name}
    return found


def suppliers_of(data_dir, material_id):
    """Supplier ids of a material: supplier component lists plus purchase orders. Nothing hardcoded."""
    ids = []
    root = Path(data_dir) / 'suppliers'
    if root.is_dir():
        profiles = supplier_profiles(data_dir)
        by_folder = {p['folder']: sid for sid, p in profiles.items()}
        for folder in sorted(root.iterdir()):
            for row in _rows(data_dir, f'suppliers/{folder.name}/components.csv'):
                if row.get('component_id') == material_id and by_folder.get(folder.name) and by_folder[folder.name] not in ids:
                    ids.append(by_folder[folder.name])
    for row in _rows(data_dir, PO_FILE):
        sid = row.get('supplier_id')
        if row.get('material_id') == material_id and sid and sid not in ids:
            ids.append(sid)
    return ids


def component_row(data_dir, material_id):
    return next((r for r in _rows(data_dir, 'soony/master/components.csv') if r.get('component_id') == material_id), {})


def unit_weight_kg(component, material_id, cfg):
    """(kg per packed unit, label) or (None, None) when no weight assumption matches."""
    by_material = cfg.get('weights_kg_by_material') or {}
    if _num(by_material.get(material_id)):
        return float(_num(by_material[material_id])), f'weight of {material_id}'
    text = f"{component.get('description') or ''} {component.get('category') or ''}".lower().replace('’', "'")
    for keyword, kg in cfg.get('weights_kg') or []:
        if str(keyword).lower() in text and _num(kg) is not None:
            return float(_num(kg)), str(keyword)
    return None, None


# ------------------------------------------------------------------ routes

class Network:
    def __init__(self, data_dir):
        self.routes = _rows(data_dir, 'soony/master/routes.csv')
        self.ports = {r['locode']: r for r in _rows(data_dir, 'soony/master/ports.csv') if r.get('locode')}
        sites = {r['site_id']: r for r in _rows(data_dir, 'soony/master/sites.csv') if r.get('site_id')}
        site = sites.get(DC_SITE) or {}
        self.dc_name = f"{site.get('city')} DC" if site.get('city') else DC_SITE
        self.shipments = _rows(data_dir, 'soony/erp/open_shipments.csv')

    def name(self, code):
        if code == DC_SITE:
            return self.dc_name
        return (self.ports.get(code) or {}).get('name', code).split(' (')[0].split(' Chhatrapati')[0]

    def origin_for(self, supplier_id, country, mode):
        """Origin code for a supplier and mode. Rule: the origin that the supplier's own open shipments use for that mode
        (most frequent), else the first port of that mode in the supplier's country that has a route. Returns (code, source)."""
        seen = Counter(r.get('origin') for r in self.shipments if r.get('supplier_id') == supplier_id and r.get('mode') == mode and r.get('origin'))
        if seen:
            return seen.most_common(1)[0][0], 'shipments'
        for code, port in self.ports.items():
            if port.get('country') == country and port.get('mode') == mode and self.chain(code):
                return code, 'country'
        return None, None

    def chain(self, origin, max_legs=3):
        """Cheapest chain of route legs from origin to the DC: list of route rows, or None."""
        best = None
        frontier = [(0.0, origin, [])]
        for _ in range(max_legs):
            nxt = []
            for days, node, legs in frontier:
                for route in self.routes:
                    if route.get('origin') != node:
                        continue
                    total = days + (_num(route.get('transit_days')) or 0)
                    path = legs + [route]
                    if route.get('destination') == DC_SITE:
                        if best is None or total < best[0]:
                            best = (total, path)
                    else:
                        nxt.append((total, route['destination'], path))
            frontier = nxt
        return best[1] if best else None

    def route_text(self, legs):
        names = [self.name(legs[0]['origin'])] + [self.name(leg['destination']) for leg in legs]
        return ' > '.join(names)


# ------------------------------------------------------------------ cost model

def _rate_triple(mode, country, cfg, rate_usd_eur):
    """(low, base, high) EUR per kg before the onward-truck surcharge, a short basis sentence, assumptions-list rows."""
    if mode == 'air':
        regions = cfg.get('air_region_by_country') or {}
        region = regions.get((country or '').upper(), 'global')
        spec = (cfg.get('air_rates_usd_per_kg') or {}).get(region) or cfg['air_rates_usd_per_kg']['global']
        triple = tuple(float(spec[k]) * rate_usd_eur for k in ('low', 'base', 'high'))
        if region == 'global':
            basis = (f"Estimate: weight x global average air rate, USD {spec['base']:g} per kg (WorldACD week 45, 2-8 Nov 2026). "
                     'No reliable per-kg figure for this corridor in Nov 2026, so the global average is used.')
            label = 'Air rate, global average (USD per kg)'
        else:
            basis = f"Estimate: weight x North America to Europe air rate, USD {spec['base']:g} per kg (Xeneta backhaul corridor, Oct 2026)."
            label = 'Air rate, North America to Europe (USD per kg)'
        rows = [{'label': label, 'value': f"low {spec['low']:g}, base {spec['base']:g}, high {spec['high']:g}",
                 'source': spec['source'], 'kind': 'market'}]
        return triple, basis, rows
    if mode == 'sea':
        container = cfg.get('sea_usd_per_40ft') or {}
        payload = float(cfg.get('sea_payload_kg_per_40ft') or 20000)
        per_kg = float(container.get('value')) / payload
        base = per_kg * rate_usd_eur
        triple = (base, base, base * float(cfg.get('sea_high_factor') or 1.5))
        basis = (f"Estimate for comparison only: USD {container.get('value'):g} per 40 ft (Drewry WCI Shanghai to Rotterdam, 19 Nov 2026) "
                 f'spread over {payload:,.0f} kg. Port, customs and local trucking charges not included.')
        rows = [{'label': 'Sea rate per 40 ft container (USD)', 'value': f"{container.get('value'):g}", 'source': container.get('source', ''), 'kind': 'market'},
                {'label': 'Assumed payload per 40 ft container (kg)', 'value': f'{payload:,.0f}', 'source': 'Our assumption', 'kind': 'assumption'}]
        return triple, basis, rows
    spec = cfg.get('road_eur_per_kg') or {}
    triple = tuple(float(spec[k]) for k in ('low', 'base', 'high'))
    basis = f"Estimate: weight x EUR {spec['base']:g} per kg, our assumption for road freight (no market source; to be confirmed)."
    rows = [{'label': 'Road rate (EUR per kg)', 'value': f"low {spec['low']:g}, base {spec['base']:g}, high {spec['high']:g}",
             'source': spec.get('source', ''), 'kind': 'assumption'}]
    return triple, basis, rows


def mode_cost(mode, country, chargeable_kg, has_onward, cfg, rate_usd_eur):
    """(cost dict or None, basis, assumption rows). Cost is None when the weight is unknown."""
    triple, basis, rows = _rate_triple(mode, country, cfg, rate_usd_eur)
    if chargeable_kg is None:
        return None, 'No price estimate: the packed weight of this part is not known.', rows
    onward = 0.0
    if has_onward:
        spec = cfg.get('onward_truck_eur_per_kg') or {}
        onward = float(spec.get('value') or 0.0)
        if onward:
            basis += f' Includes EUR {onward:g} per kg for trucking to the DC (assumption).'
            rows = rows + [{'label': 'Trucking to the DC (EUR per kg)', 'value': f'{onward:g}', 'source': spec.get('source', ''), 'kind': 'assumption'}]
    costs = [chargeable_kg * (rate + onward) for rate in triple]
    return {'low': _clean_number(costs[0]), 'base': _clean_number(costs[1]), 'high': _clean_number(costs[2])}, basis, rows


def handling_days(mode, cfg):
    return float(sum(float(v) for v in ((cfg.get('handling_days') or {}).get(mode) or {}).values()))


# ------------------------------------------------------------------ verdict wording

def _span(hours):
    hours = abs(hours)
    if hours < 48:
        return f'{hours:.0f} h'
    days = hours / 24
    return f'{days:.0f} days' if abs(days - round(days)) < 0.05 else f'{days:.1f} days'


def verdict_for(feasible, margin_hours, deadline_passed):
    if deadline_passed:
        return 'The deadline has already passed'
    if margin_hours is None:
        return 'Arrival cannot be worked out'
    return f'Makes it with {_span(margin_hours)} to spare' if feasible else f'Too late by {_span(margin_hours)}'


# ------------------------------------------------------------------ comparison

def default_deadline(data_dir):
    for row in _rows(data_dir, 'soony/master/products.csv'):
        launch = (row.get('launch_date') or '')[:10]
        if row.get('lifecycle') == 'launch' and launch:
            try:
                day = datetime.fromisoformat(launch)
                return datetime(day.year, day.month, day.day, LAUNCH_HOUR, 0, tzinfo=BERLIN)
            except ValueError:
                continue
    return None


def _berlin(moment):
    return moment.astimezone(BERLIN) if moment.tzinfo else moment.replace(tzinfo=BERLIN)


def compare(data_dir, issue, board_now, deadline, assumptions, _collect=None) -> list:
    """One lane per supplier of the issue's material. Returns [] when the data cannot support a comparison."""
    issue = issue or {}
    material = issue.get('material_id')
    shortage = issue.get('shortage')
    if not material or not isinstance(shortage, (int, float)) or shortage <= 0:
        return []
    now = _berlin(board_now)
    cutoff = _berlin(deadline) if deadline else default_deadline(data_dir)
    cfg = settings(assumptions)
    rate, rate_kind, rate_source = usd_to_eur(assumptions, cfg)
    network = Network(data_dir)
    profiles = supplier_profiles(data_dir)
    component = component_row(data_dir, material)
    unit_kg, weight_key = unit_weight_kg(component, material, cfg)
    chargeable = int(shortage) * unit_kg * float(cfg['packing_factor']) if unit_kg is not None else None
    quantity = int(shortage)
    used = _collect if _collect is not None else []
    if unit_kg is not None:
        used.append({'label': f'Packed weight per unit ({weight_key}), kg', 'value': f'{unit_kg:g}',
                     'source': 'Our assumption: part weights are not in the customer data', 'kind': 'assumption'})
    else:
        used.append({'label': 'Packed weight per unit', 'value': 'unknown', 'source': 'Not in the customer data and no assumption matches this part', 'kind': 'assumption'})
    used.append({'label': 'Packing factor on weight', 'value': f"{cfg['packing_factor']:g}", 'source': 'Our assumption: packaging and pallet allowance', 'kind': 'assumption'})
    used.append({'label': 'USD to EUR', 'value': f'{rate:.4f}', 'source': rate_source, 'kind': rate_kind})

    lanes = []
    for sid in suppliers_of(data_dir, material):
        profile = profiles.get(sid)
        if not profile:
            continue
        modes = []
        for mode in MODE_ORDER:
            origin, origin_source = network.origin_for(sid, profile['country'], mode)
            legs = network.chain(origin) if origin else None
            if not legs:
                continue
            handling = handling_days(mode, cfg)
            transit = sum(_num(leg.get('transit_days')) or 0 for leg in legs)
            total = transit + handling
            arrival = now + timedelta(days=total)
            margin = (cutoff - arrival).total_seconds() / 3600 if cutoff else None
            feasible = margin is not None and margin >= 0
            has_onward = len(legs) > 1 and legs[-1].get('mode') == 'road'
            cost, basis, rows = mode_cost(mode, profile['country'], chargeable, has_onward, cfg, rate)
            used.extend(rows)
            if origin_source == 'country':
                basis += ' Origin taken from the supplier country, not from an open shipment.'
            modes.append({
                'mode': mode, 'route': network.route_text(legs), 'feasible': bool(feasible), 'transit_days': _days(total),
                'arrives_at': arrival.isoformat(timespec='minutes'), 'hours_margin': round(margin, 1) if margin is not None else None,
                'cost_eur': cost, 'cost_per_unit_eur': round(cost['base'] / quantity, 4) if cost else None,
                'basis': basis, 'rank': None, 'verdict': verdict_for(feasible, margin, bool(cutoff and cutoff <= now)),
                '_arrival': arrival})
        if not modes:
            continue
        feasible_modes = [m for m in modes if m['feasible']]
        feasible_modes.sort(key=lambda m: (m['cost_eur'] is None, (m['cost_eur'] or {}).get('base', 0), m['_arrival']))
        for position, entry in enumerate(feasible_modes, start=1):
            entry['rank'] = position
        fastest = min(modes, key=lambda m: m['_arrival'])['mode']
        costed = [m for m in feasible_modes if m['cost_eur'] is not None]
        for entry in modes:
            entry.pop('_arrival')
        lanes.append({'supplier': profile['name'], 'supplier_id': sid, 'country': profile['country'], 'material': material,
                      'quantity': quantity, 'fastest': fastest, 'cheapest_feasible': costed[0]['mode'] if costed else None, 'modes': modes})
    return lanes


# ------------------------------------------------------------------ historical cross-check

def _price_rows(data_dir, profiles):
    """(material, supplier, term_class, currency, unit price) from the current and the legacy purchase orders."""
    out = []
    for row in _rows(data_dir, PO_FILE):
        price = _num(row.get('unit_price'))
        if price and price > 0 and row.get('currency'):
            out.append((row.get('material_id'), row.get('supplier_id'), row.get('incoterm') or '', row['currency'].upper(), price))
    path = Path(data_dir) / LEGACY_PO_FILE
    if path.exists():
        try:
            with path.open(encoding='utf-8-sig', newline='') as stream:
                for row in csv.DictReader(stream, delimiter=';'):
                    text = str(row.get('NETPR') or '').strip()
                    if ',' in text:  # German decimal comma
                        text = text.replace('.', '').replace(',', '.')
                    try:
                        price = float(text)
                    except ValueError:
                        continue
                    try:
                        sid = f"SUP-{int(str(row.get('LIFNR')).strip()):04d}"
                    except ValueError:
                        continue
                    profile = profiles.get(sid) or {}
                    if price > 0 and profile.get('currency'):  # the legacy file has no currency or term: both come from the supplier profile
                        out.append((row.get('MATNR'), sid, profile.get('incoterm') or '', profile['currency'], price))
        except (OSError, csv.Error):
            pass
    return out


def term_class(incoterm):
    head = (incoterm or '').strip().upper().split(' ')[0]
    if head in DELIVERED_TERMS:
        return 'delivered'
    if head in FOB_TERMS:
        return 'fob'
    return None


def delivered_premium(data_dir, material_id):
    """(premium fraction, delivered median, fob median, currency) for the material, or None when it was not bought on both term types."""
    grouped = {}
    for material, _supplier, term, currency, price in _price_rows(data_dir, supplier_profiles(data_dir)):
        kind = term_class(term)
        if material == material_id and kind:
            grouped.setdefault((currency, kind), []).append(price)
    for currency in sorted({c for c, _ in grouped}):
        if grouped.get((currency, 'delivered')) and grouped.get((currency, 'fob')):
            delivered, fob = statistics.median(grouped[(currency, 'delivered')]), statistics.median(grouped[(currency, 'fob')])
            if fob > 0:
                return delivered / fob - 1, delivered, fob, currency
    return None


def cross_check(data_dir, material_id, lanes, assumptions) -> dict:
    cfg = settings(assumptions)
    found = delivered_premium(data_dir, material_id) if material_id else None
    if not found:
        return {'delivered_premium_pct': None, 'per_unit_premium_eur': None, 'estimate_within_premium': None,
                'note': 'This part was not bought on both delivered and FOB or EXW terms, so there is no historical price gap to compare against.'}
    premium, delivered, fob, currency = found
    rate = usd_to_eur(assumptions, cfg)[0] if currency == 'USD' else (1.0 if currency == 'EUR' else _num(((assumptions or {}).get('fx_to_eur') or {}).get(currency)))
    per_unit_eur = (delivered - fob) * rate if rate else None
    estimates = [m['cost_per_unit_eur'] for lane in lanes for m in lane['modes'] if m.get('cost_per_unit_eur') is not None]
    highest = max(estimates) if estimates else None
    within = (highest <= per_unit_eur) if (highest is not None and per_unit_eur is not None) else None
    note = (f'Past orders of this part cost about {premium * 100:.1f} percent more on delivered terms than on FOB or EXW terms '
            f'(median {currency} {delivered:,.2f} against {fob:,.2f}). The two prices come from different suppliers, so this is a rough upper '
            'bound on freight plus duty plus margin, not a freight rate.')
    if within is True:
        note += ' The highest base estimate per unit is below that gap, so the estimate is plausible.'
    elif within is False:
        note += ' The highest base estimate per unit is ABOVE that gap: treat the estimate with extra caution.'
    return {'delivered_premium_pct': round(premium * 100, 1), 'per_unit_premium_eur': round(per_unit_eur, 4) if per_unit_eur is not None else None,
            'estimate_within_premium': within, 'note': note}


# ------------------------------------------------------------------ bundle for the crew and the tool

def _dedupe(rows):
    seen, out = set(), []
    for row in rows:
        key = (row['label'], row['value'])
        if key not in seen:
            seen.add(key)
            out.append(row)
    return out


def build(data_dir, issue, board_now, deadline, assumptions) -> dict | None:
    """The whole comparison for one issue, or None when there is nothing to compare."""
    used = []
    lanes = compare(data_dir, issue, board_now, deadline, assumptions, _collect=used)
    if not lanes:
        return None
    now = _berlin(board_now)
    cutoff = _berlin(deadline) if deadline else default_deadline(data_dir)
    return {'estimate': True, 'as_of': now.isoformat(timespec='minutes'), 'deadline': cutoff.isoformat(timespec='minutes') if cutoff else None,
            'lanes': lanes, 'cross_check': cross_check(data_dir, (issue or {}).get('material_id'), lanes, assumptions),
            'assumptions': _dedupe(used)}


def lane_for(transport, supplier_id):
    for lane in (transport or {}).get('lanes') or []:
        if lane.get('supplier_id') == supplier_id:
            return lane
    return None


def best_mode(lane):
    """The fastest mode that makes the deadline, else the fastest mode overall, else None. Second value: whether it is feasible."""
    if not lane or not lane.get('modes'):
        return None, False
    feasible = [m for m in lane['modes'] if m['feasible']]
    pool = feasible or lane['modes']
    chosen = min(pool, key=lambda m: m['transit_days'])
    return chosen, bool(feasible)
