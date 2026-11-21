"""Reviewed supplier offer: stricter approver and the public projection (no note, reply, ids or addresses)."""
import json

from app import public
from app.recovery import aware, scenario
from test_reply_loop import ingest, review
from test_workflow import workflow  # noqa: F401
from tests.test_policy import make_policy
from app import main


def test_offer_approver_is_the_stricter_of_order_value_and_air_freight():
    issue = {'shortage': 100, 'affected_products': ['CE']}
    products = [{'id': 'CE', 'name': 'CE', 'remaining': 100, 'rate_per_hour': 10}]
    plan = scenario(issue, products, '2030-11-24', 100, '2030-11-23T10:00+01:00', 21400, as_of=aware('2030-11-23T09:00+01:00'),
                    policy=make_policy(), category='Game Media')
    assert plan['value_approver'] == 'Category Lead'                      # order value alone would be Buyer
    assert plan['approver'] == {'role': 'Category Lead', 'name': 'Gus Games', 'vacancy': False, 'provisional': True}
    known = scenario(issue, products, '2030-11-24', 100, '2030-11-23T10:00+01:00', 21400, as_of=aware('2030-11-23T09:00+01:00'),
                     policy=make_policy(), category='Game Media', mode='air')
    assert known['approver']['provisional'] is False
    big = scenario(issue, products, '2030-11-24', 100, '2030-11-23T10:00+01:00', 600000, policy=make_policy(), category='Game Media')
    assert big['value_approver'] == 'CPO'                                 # freight above the monthly limit is stricter than the order value
    assert scenario(issue, products, '2030-11-24', 100, '2030-11-23T10:00+01:00', 1, as_of=aware('2030-11-23T09:00+01:00'))['approver'] is None


def detail(offer, replies=(), lines=None, fingerprint='f'):
    return {'case': {'source_fingerprint': fingerprint, 'recovery_offer': offer}, 'replies': list(replies),
            'allocation': {'lines': lines if lines is not None else [{'product_id': 'STD', 'name': 'Standard', 'short': 50}]}}


OFFER = {'offer_quantity': 6800, 'arrival_at': '2026-11-22T02:24:00+01:00', 'arrives_before_deadline': True, 'component_gap_after_offer': 0,
         'cost_eur': 21400.0, 'approver': {'role': 'Category Lead', 'name': 'Gus Games', 'vacancy': False, 'provisional': True},
         'packing_scenarios': [{'product_id': 'STD', 'name': 'Standard', 'packing_hours_after_arrival': 17.6, 'maximum_additional_units': 6800},
                               {'product_id': 'CE', 'name': 'Collector', 'packing_hours_after_arrival': 17.6, 'maximum_additional_units': 900}],
         'reviewer': 'Pat Planner', 'reviewed_at': '2026-11-21T20:00:00+01:00', 'reply_id': 'r1', 'source_fingerprint': 'f',
         'note': 'SECRET-NOTE', 'reply_body': 'SECRET-BODY'}


def test_projection_shape_and_values():
    shown = public.public_offer(detail(OFFER, [{'id': 'r1', 'simulated': True}]))
    assert shown == {'quantity': 6800, 'arrival_label': 'Sun 02:24', 'arrives_before_deadline': True, 'gap_after_offer': 0, 'cost_eur': 21400.0,
                     'approver': {'role': 'Category Lead', 'name': 'Gus Games', 'vacancy': False, 'provisional': True},
                     'packing_hours_after_arrival': 17.6, 'extra_units_short_edition': 6800, 'simulated': True,
                     'reviewed_by': 'Pat Planner', 'reviewed_at': '2026-11-21T20:00:00+01:00'}
    assert public.public_offer(detail(OFFER, [{'id': 'r1', 'simulated': False}]))['simulated'] is False
    assert public.public_offer(detail(OFFER, []))['simulated'] is False
    assert 'SECRET' not in json.dumps(shown) and 'r1' not in json.dumps(shown)


def test_offer_is_null_when_missing_or_stale():
    assert public.public_offer(detail(None)) is None
    assert public.public_offer(detail(OFFER, fingerprint='changed')) is None
    assert public.public_detail(detail(OFFER, fingerprint='changed'))['offer'] is None


def test_editions_are_never_summed():
    both = detail(OFFER, lines=[{'product_id': 'STD', 'short': 50}, {'product_id': 'CE', 'short': 5}])
    assert public.public_offer(both)['extra_units_short_edition'] is None
    assert public.public_offer(detail(OFFER, lines=[{'product_id': 'CE', 'short': 5}]))['extra_units_short_edition'] == 900
    assert public.public_offer(detail(OFFER, lines=[]))['extra_units_short_edition'] is None


def test_route_exposes_the_offer_without_note_reply_or_addresses(workflow):
    main.snapshot.update(products=[{'id': 'FG-TEST', 'name': 'Synthetic edition', 'remaining': 100, 'rate_per_hour': 10}], launch_date='2030-11-24')
    workflow.issue['affected_products'] = ['FG-TEST']
    reply = ingest(workflow).json()['replies'][0]
    done = review(workflow, reply['id'], note='SECRET-NOTE checked the original message').json()
    offer = done['offer']
    assert offer['quantity'] == 40 and offer['reviewed_by'] == 'Test Reviewer' and offer['arrives_before_deadline'] is True
    blob = json.dumps(done)
    for leak in ('SECRET-NOTE', 'supplier@example.invalid', 'reply-1@example.invalid', reply['id'], 'Available quantity'):
        assert leak not in blob.replace(json.dumps(done['replies']), ''), leak
    assert set(offer) == {'quantity', 'arrival_label', 'arrives_before_deadline', 'gap_after_offer', 'cost_eur', 'approver',
                          'packing_hours_after_arrival', 'extra_units_short_edition', 'simulated', 'reviewed_by', 'reviewed_at'}
