"""The supplier-facing draft must never carry internal documents or figures."""
from test_workflow import workflow, action


def test_draft_contains_ask_but_no_internal_material(workflow):
    workflow.issue['evidence'].append({'path': 'soony/context/memo.docx', 'label': 'CPO launch priorities',
                                       'excerpt': 'Collector first. INTERNAL-MEMO-TEXT'})
    workflow.issue['shipments'] = [{'po_number': '4500318735', 'reference': '020-48113256', 'ordered': 48000,
                                    'shipped': 28000, 'balance': 20000, 'balance_eta': '2026-11-24'}]
    body = action(workflow, 'draft').json()['case']['draft']['body']
    assert '20,000 remaining' in body and '020-48113256' in body          # the supplier's own facts
    assert 'INTERNAL-MEMO-TEXT' not in body and '13 units shipped' not in body
    assert 'Evidence references' not in body and 'CPO' not in body
    assert 'not an order' in body
