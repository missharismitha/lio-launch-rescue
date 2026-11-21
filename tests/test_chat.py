"""Case chat: evidence mode is honest, model mode is bounded, failures change nothing."""
from test_workflow import workflow
from app import main

URL = '/api/issues/game-card-shortage/chat'


def ask(workflow, text):
    return workflow.client.post(URL, json={'text': text})


def test_evidence_mode_answers_from_case_records_without_model_or_email(workflow):
    called = []
    workflow.monkeypatch.setattr(main.investigator, 'run', lambda *a, **k: called.append(1))
    r = ask(workflow, 'How big is the shortage?')
    assert r.status_code == 200
    turns = r.json()['chat']
    assert [t['role'] for t in turns] == ['user', 'assistant']
    assert all(t['mode'] == 'evidence' for t in turns)
    assert 'Uncovered: 37' in turns[1]['text']
    assert called == [] and workflow.sent == []


def test_evidence_question_lists_linked_sources(workflow):
    turns = ask(workflow, 'show me the sources').json()['chat']
    assert 'Synthetic notice' in turns[-1]['text']


def test_email_question_never_sends(workflow):
    turns = ask(workflow, 'send the supplier an email now').json()['chat']
    assert 'I have not sent an email' in turns[-1]['text']
    assert workflow.sent == []


def test_blank_and_oversized_messages_rejected(workflow):
    assert ask(workflow, '   ').status_code == 422
    assert ask(workflow, 'x' * 2001).status_code == 422
    assert workflow.client.get('/api/issues/game-card-shortage').json()['chat'] == []


def test_unknown_case_404(workflow):
    assert workflow.client.post('/api/issues/nope/chat', json={'text': 'hi'}).status_code == 404


def test_model_mode_passes_question_and_labels_mode(workflow):
    workflow.monkeypatch.setattr(main.config, 'integrations', lambda: {'ai_enabled': True, 'email_enabled': False})
    seen = {}
    def fake(issue, root, progress=None, question=None):
        seen['q'] = question
        return {'text': 'model says hi'}
    workflow.monkeypatch.setattr(main.investigator, 'run', fake)
    turns = ask(workflow, 'what next?').json()['chat']
    assert seen['q'] == 'what next?'
    assert turns[-1]['mode'] == 'model' and turns[-1]['text'] == 'model says hi'


def test_model_failure_returns_502_and_stores_nothing(workflow):
    workflow.monkeypatch.setattr(main.config, 'integrations', lambda: {'ai_enabled': True, 'email_enabled': False})
    def boom(*a, **k):
        raise RuntimeError('secret upstream detail')
    workflow.monkeypatch.setattr(main.investigator, 'run', boom)
    r = ask(workflow, 'why?')
    assert r.status_code == 502 and 'secret upstream detail' not in r.text
    assert workflow.client.get('/api/issues/game-card-shortage').json()['chat'] == []


def test_changed_sources_during_answer_rejected(workflow):
    workflow.monkeypatch.setattr(main.config, 'integrations', lambda: {'ai_enabled': True, 'email_enabled': False})
    def mutate(issue, root, progress=None, question=None):
        workflow.issue['shortage'] += 1  # evidence changes mid-answer
        return {'text': 'stale'}
    workflow.monkeypatch.setattr(main.investigator, 'run', mutate)
    r = ask(workflow, 'why?')
    assert r.status_code == 409
    assert workflow.client.get('/api/issues/game-card-shortage').json()['chat'] == []
