import json

from test_workflow import workflow
from app import mapdata

SITES = 'site_id,name,operator,type,country,city,lat,lon\nDC-HAM,Hub Hamburg,Soony,dc,DE,Hamburg,53.55,9.99\nPL-1,Plant,Soony,plant,DE,X,1,1\n'
PORTS = 'locode,name,country,lat,lon,mode\nCNYTN,Yantian,CN,22.5,114.2,sea\nDEHAM,Hamburg,DE,53.5,9.9,sea\nBAD,NoCoord,XX,,,sea\n'
ROUTES = 'route_id,origin,destination,mode,carrier_id,transit_days,via\nRT-1,CNYTN,DEHAM,sea,LSP-SECRET,32,SGSIN\nRT-2,A,B,rail,LSP-SECRET,3,\n'
COMPONENTS = 'component_id,description,category,uom\nCMP-1,Game Card 128 GB,Media,PC\n'
SHIP_HEAD = 'shipment_id,carrier_id,mode,reference,supplier_id,po_numbers,material_ids,route_id,origin,destination,via,dest_site,etd,eta,status,last_lat,last_lon,updated_at,note\n'
SHIPS = (SHIP_HEAD +
         'SHP-9,LSP-SECRET,sea,CONT1234567,SUP-0001,4500999111,CMP-1,RT-1,CNYTN,DEHAM,SGSIN,DC-HAM,2026-10-14,2026-11-10,in_transit,10.5,20.5,2026-11-20T10:00:00+01:00,note SECRETNOTE\n'
         'SHP-1,LSP-SECRET,sea,CONT7654321,SUP-0001,4500999222,CMP-1,RT-1,CNYTN,DEHAM,SGSIN,DC-HAM,2026-10-01,2026-11-30,in_transit,11.5,21.5,2026-11-21T09:00:00+01:00,\n'
         'SHP-2,LSP-SECRET,air,AWB-555-SECRET,SUP-0001,4500999333,CMP-1,,A,B,,DC-HAM,2026-10-02,2026-11-01,delayed,12,22,2026-11-19T09:00:00+01:00,\n'
         'SHP-3,LSP-SECRET,air,AWB-NOCOORD,SUP-0001,4500999444,CMP-1,,A,B,,DC-HAM,2026-10-02,2026-11-01,in_transit,,,2026-11-19T09:00:00+01:00,\n')
PROFILE = ('supplier_id,name,legal_name,category,country,city,lat,lon,currency,contact_name,contact_email,phone,notes\n'
           'SUP-0001,Acme,Acme Ltd,Game Media,KR,Seoul,37.5,127.0,USD,Pat Contact,pat@acme.invalid,+82 1,SECRETNOTE\n')


def write(root, files):
    for rel, text in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')


def full(root):
    write(root, {'soony/master/sites.csv': SITES, 'soony/master/ports.csv': PORTS, 'soony/master/routes.csv': ROUTES,
                 'soony/master/components.csv': COMPONENTS, 'soony/erp/open_shipments.csv': SHIPS,
                 'suppliers/SUP-0001_Acme/profile.csv': PROFILE,
                 'suppliers/SUP-0002_NoCoord/profile.csv': PROFILE.replace('SUP-0001', 'SUP-0002').replace('37.5,127.0', ',')})


def test_maps_everything(tmp_path):
    full(tmp_path)
    data = mapdata.build(tmp_path, '2026-11-24')
    assert data['hub'] == {'name': 'Hub Hamburg', 'lat': 53.55, 'lon': 9.99}
    assert [p['code'] for p in data['ports']] == ['CNYTN', 'DEHAM']
    assert data['routes'] == [{'id': 'RT-1', 'mode': 'sea', 'origin': 'CNYTN', 'destination': 'DEHAM', 'via': 'SGSIN', 'transit_days': 32}]
    assert data['suppliers'] == [{'id': 'SUP-0001', 'name': 'Acme', 'country': 'KR', 'lat': 37.5, 'lon': 127.0, 'category': 'Game Media'}]
    assert data['deadline'].startswith('2026-11-24T20:00')
    assert data['as_of'].startswith('2026-11-21T09:00')
    assert len(data['shipments']) == 3
    first = data['shipments'][0]
    assert first['supplier_id'] == 'SUP-0001' and first['material'] == 'Game Card 128 GB' and first['lat'] == 11.5


def test_ids_opaque_and_stable(tmp_path):
    full(tmp_path)
    a = mapdata.build(tmp_path, '2026-11-24')
    assert [s['id'] for s in a['shipments']] == ['s1', 's2', 's3']
    assert a == mapdata.build(tmp_path, '2026-11-24')


def test_late_flags(tmp_path):
    full(tmp_path)
    by_eta = {s['eta']: s['late'] for s in mapdata.build(tmp_path, '2026-11-24')['shipments']}
    assert by_eta == {'2026-11-01': True, '2026-11-10': False, '2026-11-30': True}  # delayed, on time, after deadline
    assert not any(s['late'] for s in mapdata.build(tmp_path, None)['shipments'] if s['status'] != 'delayed')


def test_secrets_absent(tmp_path):
    full(tmp_path)
    blob = json.dumps(mapdata.build(tmp_path, '2026-11-24'))
    for token in ('CONT', 'AWB', '4500', 'LSP-', 'SECRET', 'Pat', 'acme.invalid', '+82', 'SHP-', '.csv', 'suppliers/', 'Acme Ltd'):
        assert token not in blob


def test_missing_files(tmp_path):
    assert mapdata.build(tmp_path, '2026-11-24') is None
    write(tmp_path, {'soony/master/sites.csv': SITES})
    data = mapdata.build(tmp_path, None)
    assert data['hub']['name'] == 'Hub Hamburg'
    assert data['suppliers'] == data['ports'] == data['routes'] == data['shipments'] == []
    assert data['as_of'] is None and data['deadline'] is None


def test_overview_includes_map(workflow, tmp_path):
    full(tmp_path / 'customer')
    body = workflow.client.get('/api/overview').json()
    assert body['map']['hub']['name'] == 'Hub Hamburg' and len(body['map']['shipments']) == 3
    blob = json.dumps(body)
    assert 'CONT' not in blob and '4500' not in blob and 'LSP-' not in blob
