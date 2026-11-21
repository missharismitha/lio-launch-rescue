"""Portal synchronization boundaries; every HTTP response is synthetic."""
import hashlib
import json
from pathlib import Path

import pytest

from app import sync
from app.sync import PortalSync, safe_path


def entry(path, content):
    return {'path': path, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest(),
            'url': 'https://ignored.example.invalid/' + path}


class Response:
    def __init__(self, payload=None, content=b'', status=200):
        self.payload, self.content, self.status_code = payload, content, status

    def json(self):
        return self.payload


def serve(monkeypatch, entries, contents):
    calls = []

    def get(url, **kwargs):
        calls.append((url, kwargs))
        assert kwargs['allow_redirects'] is False
        assert kwargs['headers']['Authorization'] == 'Bearer synthetic-token'
        if url.endswith('/api/v1/files'):
            return Response({'count': len(entries), 'files': entries})
        relative = url.split('/api/v1/files/', 1)[1]
        return Response(content=contents[relative])

    monkeypatch.setattr(sync.requests, 'get', get)
    return calls


def test_verified_changes_publish_and_unchanged_files_are_not_downloaded(tmp_path, monkeypatch):
    root = tmp_path / 'data'
    root.mkdir()
    unchanged = root / 'same.csv'
    unchanged.write_bytes(b'old')
    entries = [entry('same.csv', b'old'), entry('nested/new.csv', b'new')]
    calls = serve(monkeypatch, entries, {'nested/new.csv': b'new'})
    portal = PortalSync(root, tmp_path / 'state', 'synthetic-token')
    result = portal.run()
    assert result['error'] is None
    assert result['last_checked'] and result['last_success']
    assert result['changed_files'] == ['nested/new.csv']
    assert (root / 'nested/new.csv').read_bytes() == b'new'
    assert len(calls) == 2
    assert all('ignored.example.invalid' not in url for url, _ in calls)
    assert (tmp_path / 'state/portal-manifest.json').exists()


def test_corrupt_later_download_does_not_publish_earlier_changes(tmp_path, monkeypatch):
    root = tmp_path / 'data'
    root.mkdir()
    (root / 'first.csv').write_bytes(b'original')
    entries = [entry('first.csv', b'correct'), entry('second.csv', b'expected')]
    serve(monkeypatch, entries, {'first.csv': b'correct', 'second.csv': b'corrupt'})
    result = PortalSync(root, tmp_path / 'state', 'synthetic-token').run()
    assert result['error']
    assert result['last_success'] is None
    assert result['changed_files'] == []
    assert (root / 'first.csv').read_bytes() == b'original'
    assert not (root / 'second.csv').exists()


@pytest.mark.parametrize('path', ['../secret.txt', '/absolute.csv', 'C:/outside.csv', 'a\\outside.csv', '', '.'])
def test_manifest_paths_cannot_escape_or_target_root(tmp_path, path):
    with pytest.raises(ValueError):
        safe_path(tmp_path / 'data', path)


def test_unauthorized_portal_preserves_local_files_and_reports_staleness(tmp_path, monkeypatch):
    root = tmp_path / 'data'
    root.mkdir()
    (root / 'file.csv').write_bytes(b'original')
    monkeypatch.setattr(sync.requests, 'get', lambda *a, **kw: Response(status=401))
    result = PortalSync(root, tmp_path / 'state', 'synthetic-token').run()
    assert result['error']
    assert result['last_success'] is None
    assert (root / 'file.csv').read_bytes() == b'original'


def test_unconfigured_token_makes_no_network_call(tmp_path, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail('network should not be called without token')

    monkeypatch.setattr(sync.requests, 'get', forbidden)
    result = PortalSync(tmp_path / 'data', tmp_path / 'state', '').run()
    assert result['mode'] == 'local snapshot'
    assert result['error']


def test_portal_removal_retires_old_evidence_outside_active_data(tmp_path, monkeypatch):
    root, state = tmp_path / 'data', tmp_path / 'state'
    root.mkdir()
    state.mkdir()
    (root / 'old-notice.pdf').write_bytes(b'old evidence')
    (state / 'portal-manifest.json').write_text(json.dumps({
        'count': 1, 'files': [entry('old-notice.pdf', b'old evidence')]
    }), encoding='utf-8')
    serve(monkeypatch, [], {})
    result = PortalSync(root, state, 'synthetic-token').run()
    assert result['error'] is None
    assert result['changed_files'] == ['old-notice.pdf (removed from portal)']
    assert not (root / 'old-notice.pdf').exists()
    retired = list((state / 'retired').rglob('old-notice.pdf'))
    assert len(retired) == 1
    assert retired[0].read_bytes() == b'old evidence'


def test_manifest_traversal_never_downloads_or_writes_outside_data(tmp_path, monkeypatch):
    calls = serve(monkeypatch, [entry('../outside.pdf', b'document')], {})
    result = PortalSync(tmp_path / 'data', tmp_path / 'state', 'synthetic-token').run()
    assert result['error']
    assert len(calls) == 1
    assert not (tmp_path / 'outside.pdf').exists()
