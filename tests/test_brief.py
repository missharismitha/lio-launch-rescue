from app.brief import NONE_FEASIBLE, build_brief

ISSUE = {'hours_left': 30}
APPROVER = {'role': 'Head of Procurement', 'name': 'A. Person', 'vacancy': False}
VALUE = {'headline_eur': 1000.0}


def opt(**kw):
    base = {'rank': 1, 'feasible': 'yes', 'supplier': 'Acme Cards', 'quantity': 1000, 'mode': 'air',
            'eta': '2026-11-21T20:00:00+01:00', 'total_eur': 5000.0, 'copies_gained': 900}
    base.update(kw)
    return base


def test_top_ranked_feasible_option_is_recommended():
    b = build_brief(ISSUE, [opt(rank=2, supplier='Second'), opt(rank=1), opt(rank=3, feasible='late')], APPROVER, VALUE, [])
    assert b['recommendation'] == 'Ask Acme Cards for 1,000 units by air'
    assert b['price_eur'] == 5000.0 and b['copies_gained'] == 900
    assert b['approver'] == {'role': 'Head of Procurement', 'name': 'A. Person', 'vacancy': False}
    assert b['deadline_label'] == '30 packing hours left'


def test_confidence_levels():
    assert build_brief(ISSUE, [opt()], APPROVER, VALUE, [], numbers_verified=True)['confidence'] == 'high'
    assert build_brief(ISSUE, [opt()], APPROVER, VALUE, [], numbers_verified=False)['confidence'] == 'medium'
    assert build_brief(ISSUE, [opt(total_eur=None)], APPROVER, VALUE, [], numbers_verified=True)['confidence'] == 'medium'
    assert build_brief(ISSUE, [opt(feasible='late')], APPROVER, VALUE, [], numbers_verified=True)['confidence'] == 'low'
    assert build_brief(None, [opt()], APPROVER, VALUE, [], numbers_verified=True)['confidence'] == 'low'


def test_none_feasible():
    b = build_brief(ISSUE, [opt(feasible='late'), opt(feasible='unknown')], APPROVER, VALUE, [])
    assert b['recommendation'] == NONE_FEASIBLE and b['confidence'] == 'low'
    assert b['price_eur'] is None and b['copies_gained'] is None
    assert build_brief(ISSUE, [], None, None, [])['recommendation'] == NONE_FEASIBLE


def test_unknown_price_and_eta_become_questions_never_invented():
    b = build_brief(ISSUE, [opt(total_eur=None, eta=None)], APPROVER, VALUE, [])
    assert b['price_eur'] is None
    assert 'Confirm the air-freight price' in b['verify_next']
    assert any(q.startswith('Confirm the earliest delivery time') for q in b['verify_next'])
    assert 'Count the cards used since the last stock snapshot' in b['verify_next']


def test_tolerates_missing_keys_and_bool_feasible():
    b = build_brief({}, [{'title': 'Use reserved stock', 'feasible': True}], None, None, None)
    assert b['recommendation'] == 'Use reserved stock'
    assert b['approver'] is None and b['confidence'] == 'low'


def test_approver_falls_back_to_option_and_vacancy_is_a_risk():
    top = opt(approver={'role': 'Category Lead', 'name': None, 'vacancy': True})
    b = build_brief(ISSUE, [top], None, VALUE, [])
    assert b['approver']['role'] == 'Category Lead' and b['approver']['vacancy'] is True
    assert any('vacant' in r for r in b['risks'])
