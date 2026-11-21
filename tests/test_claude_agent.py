"""Claude CLI backend: parsed with a fake process; the real CLI is never started in tests."""
import json
import io
import pytest
from app import claude_agent


class FakeProc:
    def __init__(self, lines):
        self.stdout = io.StringIO('\n'.join(json.dumps(x) for x in lines) + '\n')

    def wait(self):
        pass

    def kill(self):
        pass


def fake_cli(monkeypatch, lines, seen=None):
    monkeypatch.setattr(claude_agent.shutil, 'which', lambda name: 'claude')

    def popen(cmd, **kwargs):
        if seen is not None:
            seen.update(cmd=cmd, cwd=kwargs.get('cwd'))
        return FakeProc(lines)

    monkeypatch.setattr(claude_agent.subprocess, 'Popen', popen)


def test_streams_tool_steps_and_returns_text(tmp_path, monkeypatch):
    seen, steps = {}, []
    fake_cli(monkeypatch, [
        {'type': 'system', 'model': 'claude-test'},
        {'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'name': 'Read', 'input': {'file_path': 'suppliers/X/notice.pdf'}}]}},
        {'type': 'result', 'is_error': False, 'result': '## Verdict\nno'}], seen)
    out = claude_agent.run({'id': 'i'}, tmp_path, steps.append)
    assert out['text'].startswith('## Verdict') and out['model'] == 'claude-test'
    assert steps == ['Read a supplier notice']
    cmd = seen['cmd']
    assert cmd[cmd.index('--tools') + 1] == 'Read,Grep,Glob'          # read-only tools only
    assert 'Bash' not in ' '.join(cmd) and 'Write' not in ' '.join(cmd)
    assert seen['cwd'] == str(tmp_path)                                 # confined to the data folder


def test_expired_login_gives_actionable_error(tmp_path, monkeypatch):
    fake_cli(monkeypatch, [{'type': 'result', 'is_error': True, 'result': 'Failed to authenticate: OAuth session expired'}])
    with pytest.raises(ValueError, match='claude auth login'):
        claude_agent.run({'id': 'i'}, tmp_path)


def test_failed_run_saves_nothing(tmp_path, monkeypatch):
    fake_cli(monkeypatch, [{'type': 'assistant', 'message': {'content': []}}])
    with pytest.raises(ValueError):
        claude_agent.run({'id': 'i'}, tmp_path)
