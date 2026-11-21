"""Exercise the real orchestrator against synthetic state without external effects."""
from test_workflow import workflow
from app import main


def test_agent_reconciles_and_drafts_without_auto_send(workflow):
    workflow.monkeypatch.setattr(main, 'agent_status', {'running': True, 'steps': [], 'state': 'investigating', 'error': None})
    workflow.monkeypatch.setattr(main, 'refresh', lambda **kwargs: main.overview())
    workflow.monkeypatch.setattr(main.config, 'integrations', lambda: {'ai_enabled': False, 'inbox_enabled': False, 'email_enabled': False})
    main.agent_cycle('game-card-shortage')
    case = main.store.get(workflow.issue)
    assert case['state'] == 'drafted'
    assert main.agent_status['state'] == 'awaiting_human_review'
    assert not main.agent_status['running']
    assert main.agent_status['steps'][-1]['message'] == 'Ready for your review'
    from app import public
    shown = [s['message'] for s in public.public_overview(main.overview())['agent']['steps']]
    assert shown and all(not any(w in m.lower() for w in ('reconcil', 'provenance', 'model-directed', 'tool')) for m in shown)
    assert workflow.sent == []
    # Repeating a cycle preserves the existing draft and does not send.
    initial_events = main.store.events(workflow.issue['id'])
    main.agent_cycle('game-card-shortage')
    assert main.store.events(workflow.issue['id']) == initial_events
    assert workflow.sent == []


def test_agent_failure_does_not_fake_completion(workflow):
    workflow.monkeypatch.setattr(main, 'agent_status', {'running': True, 'steps': [], 'state': 'investigating', 'error': None})
    def failed(**kwargs):
        raise ValueError('Synthetic source error')
    workflow.monkeypatch.setattr(main, 'refresh', failed)
    main.agent_cycle('game-card-shortage')
    assert main.agent_status['state'] == 'needs_attention'
    assert main.agent_status['error']
    assert not main.agent_status['running']
    assert main.store.get(workflow.issue)['draft'] is None
    assert workflow.sent == []
