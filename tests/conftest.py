"""No test may reach a real model: the agent loop is off and its network seam raises unless a test replaces them."""
import pytest

from app import agent_loop


@pytest.fixture(autouse=True)
def no_real_model(monkeypatch):
    def blocked(payload, timeout):
        raise AssertionError('a test tried to call the model')
    monkeypatch.setattr(agent_loop, 'available', lambda: False)
    monkeypatch.setattr(agent_loop, '_post', blocked)
