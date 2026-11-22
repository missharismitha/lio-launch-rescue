"""Public transport map projection built from the customer data folder.

Allowlist only: no container or air waybill numbers, PO numbers, carrier ids, contacts, addresses, notes or file names.
"""
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

from app.pricing import read_rows
from app.public import safe_text

BERLIN = ZoneInfo('Europe/Berlin')
MODES = ('air', 'sea', 'road')
_cache = {}


def _coord(row, lat='lat', lon='lon'):
    try:
        a, b = float(row.get(lat)), float(row.get(lon))
    except (TypeError, ValueError):
        return None
    if a != a or b != b or not (-90 <= a <= 90 and -180 <= b <= 180):
        return None
    return a, b


def _text(value, limit=80):
    return safe_text(value or '', limit)


def _mode(value):
    value = (value or '').strip().lower()
    return value if value in MODES else None


def _when(value, end_of_day=True):
    text = (value or '').strip()
    if not text:
        return None
    try:
        if len(text) == 10:
            return datetime.combine(datetime.fromisoformat(text).date(), time(23, 59) if end_of_day else time(0), BERLIN)
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=BERLIN) if parsed.tzinfo is None else parsed
    except ValueError:
        return None


def _deadline(launch_date):
    try:
        return datetime.combine(datetime.fromisoformat(str(launch_date)[:10]).date(), time(20), BERLIN)
    except (TypeError, ValueError):
        return None


def _int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def build(data_dir, launch_date=None):
    data_dir = Path(data_dir)
    sites = read_rows(data_dir, 'soony/master/sites.csv')
    hub_row = next((r for r in sites if (r.get('type') or '').strip().lower() == 'dc' and _coord(r)), None)
    if hub_row is None:
        return None
    lat, lon = _coord(hub_row)
    hub = {'name': _text(hub_row.get('name')) or 'Hub', 'lat': lat, 'lon': lon}

    ports = []
    for row in read_rows(data_dir, 'soony/master/ports.csv'):
        point, mode, code = _coord(row), _mode(row.get('mode')), _text(row.get('locode'), 12)
        if point and code:
            ports.append({'code': code, 'name': _text(row.get('name')) or code, 'lat': point[0], 'lon': point[1], 'mode': mode})

    routes = []
    for row in read_rows(data_dir, 'soony/master/routes.csv'):
        mode, rid = _mode(row.get('mode')), _text(row.get('route_id'), 20)
        if mode and rid:
            routes.append({'id': rid, 'mode': mode, 'origin': _text(row.get('origin'), 12), 'destination': _text(row.get('destination'), 12),
                           'via': _text(row.get('via'), 12) or None, 'transit_days': _int(row.get('transit_days'))})

    suppliers = []
    profiles = sorted((data_dir / 'suppliers').glob('*/profile.csv')) if (data_dir / 'suppliers').is_dir() else []
    for profile in profiles:
        for row in read_rows(data_dir, profile.relative_to(data_dir).as_posix())[:1]:
            point, sid = _coord(row), _text(row.get('supplier_id'), 20)
            if point and sid:
                suppliers.append({'id': sid, 'name': _text(row.get('name')) or sid, 'country': _text(row.get('country'), 4) or None,
                                  'lat': point[0], 'lon': point[1], 'category': _text(row.get('category'), 40) or None})
    suppliers.sort(key=lambda s: s['id'])

    materials = {r.get('component_id'): r.get('description') for r in read_rows(data_dir, 'soony/master/components.csv')}
    deadline = _deadline(launch_date)
    rows = sorted(read_rows(data_dir, 'soony/erp/open_shipments.csv'),
                  key=lambda r: ((r.get('etd') or ''), (r.get('shipment_id') or '')))
    shipments, stamps = [], []
    for row in rows:
        mode = _mode(row.get('mode'))
        if not mode:
            continue
        point = _coord(row, 'last_lat', 'last_lon')
        if not point:
            continue
        status = (row.get('status') or '').strip().lower()
        eta = _when(row.get('eta'))
        first = (row.get('material_ids') or '').replace(';', ',').split(',')[0].strip()
        stamp = _when(row.get('updated_at'))
        if stamp:
            stamps.append(stamp)
        shipments.append({
            'id': 's%d' % (len(shipments) + 1), 'supplier_id': _text(row.get('supplier_id'), 20) or None, 'mode': mode,
            'status': _text(status, 30), 'origin': _text(row.get('origin'), 12), 'destination': _text(row.get('destination'), 12),
            'lat': point[0], 'lon': point[1], 'eta': (row.get('eta') or '').strip()[:25] or None, 'etd': (row.get('etd') or '').strip()[:25] or None,
            'late': status == 'delayed' or bool(deadline and eta and eta > deadline),
            'material': _text(materials.get(first), 80) or None})
    return {'as_of': max(stamps).isoformat(timespec='minutes') if stamps else None,
            'deadline': deadline.isoformat(timespec='minutes') if deadline else None,
            'hub': hub, 'suppliers': suppliers, 'ports': ports, 'routes': routes, 'shipments': shipments}


def cached(data_dir, launch_date=None):
    """build() memoised on the newest mtime of the data folder's CSV files; never raises."""
    try:
        root = Path(data_dir)
        stamp = max((p.stat().st_mtime_ns for p in root.rglob('*.csv')), default=0) if root.is_dir() else 0
        key = (str(root), launch_date)
        if _cache.get('key') != key or _cache.get('stamp') != stamp:
            _cache.update(key=key, stamp=stamp, value=build(root, launch_date))
        return _cache['value']
    except Exception:
        return None
