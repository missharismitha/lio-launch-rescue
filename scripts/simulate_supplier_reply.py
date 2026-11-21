"""Simulate a supplier reply for demos and rehearsals (NOT a real supplier).

The reply goes through the app's real import path (sender check, case tag, labelled fields,
human review), is marked with the header X-Lio-Simulated: yes, and its first body line says
SIMULATED. Numbers are scenario inputs you choose, never facts from the customer data.

Usage (app must be running):
  python scripts/simulate_supplier_reply.py --scenario offer
  python scripts/simulate_supplier_reply.py --scenario late --review "Your Name"
Scenarios: offer (can ship now, arrives before the last packing hour), late (arrives after
launch), partial (only part of the gap, arrives in time).
Use --code if LIO_ACCESS_CODE is set. Data under data/ is read only to find the supplier's
contact address (the importer requires the sender to match it); nothing is printed from it.
"""
import argparse
import csv
import json
import sys
import urllib.error
import urllib.request
import http.cookiejar
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formatdate
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SCENARIOS = {
    # quantity, hours from now until warehouse arrival, total cost EUR (all invented for the simulation)
    'offer': (6800, 8, 21400.0),
    'late': (6800, 40, 18900.0),
    'partial': (3000, 10, 9800.0),
}


def contact_email(supplier_glob):
    for profile in sorted((ROOT / 'data' / 'soony-data' / 'suppliers').glob(supplier_glob + '/profile.csv')):
        with profile.open(encoding='utf-8-sig', newline='') as stream:
            row = next(csv.DictReader(stream), {})
        if row.get('contact_email'):
            return row['contact_email']
    raise SystemExit('No supplier contact found; pass --supplier with a folder pattern such as SUP-0010*')


def opener(base, code):
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    if code:
        request = urllib.request.Request(base + '/api/login', data=json.dumps({'code': code}).encode(),
                                         headers={'Content-Type': 'application/json'}, method='POST')
        op.open(request, timeout=20)
    return op


def call(op, url, data=None, content_type='application/json'):
    request = urllib.request.Request(url, data=data, headers={'Content-Type': content_type} if data is not None else {},
                                     method='POST' if data is not None else 'GET')
    try:
        with op.open(request, timeout=60) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        sys.exit(f'HTTP {error.code}: {error.read().decode("utf-8", "replace")[:300]}')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--scenario', choices=sorted(SCENARIOS), default='offer')
    parser.add_argument('--base', default='http://127.0.0.1:8000')
    parser.add_argument('--issue', default='game-card-shortage')
    parser.add_argument('--supplier', default='SUP-0010*', help='supplier folder pattern under data/soony-data/suppliers')
    parser.add_argument('--code', default='', help='access code, only if LIO_ACCESS_CODE is set')
    parser.add_argument('--review', default='', help='reviewer name: also run the human review step with the parsed numbers')
    args = parser.parse_args()

    quantity, hours, cost = SCENARIOS[args.scenario]
    arrival = (datetime.now(timezone.utc).astimezone() + timedelta(hours=hours)).replace(microsecond=0, second=0)
    op = opener(args.base.rstrip('/'), args.code)
    issue = call(op, f'{args.base}/api/issues/{args.issue}')
    material = 'CMP-GAM-001' if 'card' in issue.get('title', '').lower() else 'the requested part'

    message = EmailMessage()
    message['From'] = contact_email(args.supplier)
    message['To'] = 'launch-team@example.invalid'
    message['Subject'] = f'Re: [Lio {args.issue}] Launch supply verification — {material}'
    message['Date'] = formatdate(localtime=True)
    message['Message-ID'] = f'<sim-{uuid.uuid4().hex}@simulation.invalid>'
    message['X-Lio-Simulated'] = 'yes'
    message.set_content(
        '*** SIMULATED SUPPLIER REPLY FOR DEMO. NOT FROM THE SUPPLIER. ***\n\n'
        'Dear Soony launch team,\n\n'
        'Thank you for your inquiry. Our answer to your questions:\n\n'
        f'Available quantity: {quantity}\n'
        f'Warehouse arrival: {arrival.isoformat()}\n'
        f'Total cost EUR: {cost:.2f}\n\n'
        'This is a scenario for rehearsal only; every figure above was chosen by the person running the simulation.\n')
    raw = message.as_bytes()

    result = call(op, f'{args.base}/api/issues/{args.issue}/replies/import', raw, 'message/rfc822')
    replies = result.get('replies', [])
    print(f'Imported simulated reply ({args.scenario}). Replies on the case: {len(replies)}; state: {result["case"]["state"]}.')
    if args.review:
        reply = replies[0]
        reviewed = call(op, f'{args.base}/api/issues/{args.issue}/replies/review', json.dumps({
            'message_id': reply['id'], 'reviewer': args.review, 'quantity': quantity,
            'arrival_at': arrival.isoformat(), 'cost_eur': cost,
            'note': 'Reviewed a SIMULATED reply for rehearsal; no real supplier confirmed anything.'}).encode())
        print('Reviewed. Case state:', reviewed['case']['state'])
    else:
        print('Next: review it in the app (or rerun with --review "Your Name").')


if __name__ == '__main__':
    main()
