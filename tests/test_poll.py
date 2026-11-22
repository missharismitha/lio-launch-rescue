"""The background poll syncs at once on a host without data, and waits one interval otherwise."""
import asyncio

from app import main


def run_one_cycle(monkeypatch, tmp_path, data_exists, token):
    data = tmp_path / 'data'
    if data_exists:
        data.mkdir()
    monkeypatch.setattr(main.config, 'DATA_DIR', data)
    monkeypatch.setattr(main.config, 'PORTAL_TOKEN', token)
    monkeypatch.setattr(main.config, 'integrations', lambda: {'inbox_enabled': False})
    order = []

    async def fake_sleep(seconds):
        order.append('sleep')
        raise asyncio.CancelledError

    def fake_refresh(sync=False):
        order.append(('refresh', sync))

    monkeypatch.setattr(main.asyncio, 'sleep', fake_sleep)
    monkeypatch.setattr(main, 'refresh', fake_refresh)
    try:
        asyncio.run(main.poll())
    except asyncio.CancelledError:
        pass
    return order


def test_fresh_host_syncs_before_first_wait(monkeypatch, tmp_path):
    assert run_one_cycle(monkeypatch, tmp_path, data_exists=False, token='t') == [('refresh', True), 'sleep']


def test_existing_data_with_a_token_also_checks_the_portal_at_startup(monkeypatch, tmp_path):
    assert run_one_cycle(monkeypatch, tmp_path, data_exists=True, token='t') == [('refresh', True), 'sleep']


def test_no_token_waits_first(monkeypatch, tmp_path):
    assert run_one_cycle(monkeypatch, tmp_path, data_exists=False, token='') == ['sleep']
