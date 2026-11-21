"""Model-directed tool loop for the procurement agent.

The model picks tools (app/tools.py); code validates every call and owns every number. This is the only module
that makes a network call: one `_post` seam to the OpenAI Responses API, which tests replace. When the model is
unavailable, fails, or makes no valid action call, `operate` returns 'fell back' and the fixed rule order runs.
"""
from __future__ import annotations

import json
import os
import time

import requests

from app import crew, labels, tools

# One place for every budget; each can be overridden from the environment.
DEFAULTS = {'LIO_AGENT_TURNS': 8, 'LIO_AGENT_CALLS': 20, 'LIO_AGENT_SECONDS': 45, 'LIO_AGENT_REQUEST_SECONDS': 25,
            'LIO_AGENT_MAX_OUTPUT': 4000}
TOOL_CAPS = {'search_documents': 4, 'read_document': 3, 'propose_option': 3, 'draft_supplier_message': 2,
             'draft_escalation': 1, 'set_recommendation': 1}
MAX_CONSECUTIVE_REJECTED = 3
RESULT_CHARS = 1500
READ_RESULT_CHARS = 6200
ENDPOINT = 'https://api.openai.com/v1/responses'


class AgentError(Exception):
    """The model call failed. `retry` is True for rate limits, server errors and timeouts."""

    def __init__(self, message, retry=False):
        super().__init__(message)
        self.retry = retry


def _budget(name):
    try:
        return max(1, int(os.getenv(name, DEFAULTS[name])))
    except ValueError:
        return DEFAULTS[name]


def model_name():
    return os.getenv('LIO_AGENT_MODEL') or os.getenv('LIO_AI_MODEL')


def available():
    return bool(os.getenv('OPENAI_API_KEY') and model_name())


def _post(payload, timeout):
    """The single network seam. Returns the parsed response or raises AgentError. Never logs the key or the payload."""
    try:
        response = requests.post(ENDPOINT, headers={'Authorization': 'Bearer ' + os.getenv('OPENAI_API_KEY', ''), 'Content-Type': 'application/json'},
                                 json=payload, timeout=timeout)
    except requests.RequestException:
        raise AgentError('timeout', retry=True)
    if response.status_code == 429 or response.status_code >= 500:
        raise AgentError(f'http {response.status_code}', retry=True)
    if response.status_code != 200:
        raise AgentError(f'http {response.status_code}')
    try:
        return response.json()
    except ValueError:
        raise AgentError('bad response')


def _request(payload, deadline):
    """One model call with a single retry when time remains."""
    for attempt in (0, 1):
        remaining = deadline - time.monotonic()
        if remaining < 2:
            raise AgentError('out of time')
        try:
            return _post(payload, min(remaining, _budget('LIO_AGENT_REQUEST_SECONDS')))
        except AgentError as error:
            if attempt == 1 or not error.retry:
                raise
    raise AgentError('unreachable')


def _text_of(outputs):
    return '\n'.join(part.get('text', '') for entry in outputs if entry.get('type') == 'message'
                     for part in entry.get('content', []) if part.get('type') == 'output_text')


def _fold(history, upto):
    """Older tool results are replaced by a stub; the model can call get_case again. State lives on the blackboard."""
    for item in history[:upto]:
        if item.get('type') == 'function_call_output' and item.get('output') != '{"folded":true}':
            item['output'] = '{"folded":true}'


def _capped(result, name):
    text = json.dumps(result, default=str)
    limit = READ_RESULT_CHARS if name == 'read_document' else RESULT_CHARS
    if len(text) > limit:
        text = json.dumps({'ok': result.get('ok', True), 'truncated': True, 'text': text[:limit - 60]})
    return text


def _final_check(board, text):
    """Validate the final JSON. Anything invalid is ignored: code picks the top option itself."""
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return None
    if tools.schema_error(labels.FINAL_SCHEMA, data):
        return None
    return data


def operate(board):
    """Run the model's tool loop on the blackboard. Returns 'done', 'needs human review' (stopped early) or 'fell back'."""
    started = time.monotonic()
    if not available():
        board['run_mode'] = 'rule_based'
        return 'fell back'
    budgets = {'turns': _budget('LIO_AGENT_TURNS'), 'calls': _budget('LIO_AGENT_CALLS'), 'seconds': _budget('LIO_AGENT_SECONDS')}
    deadline = started + budgets['seconds']
    stats = board.setdefault('agent', {'tool_calls': 0, 'rejected': 0, 'seconds': 0.0})
    stats.update(tool_calls=0, rejected=0, actions_ok=0)
    crew.board_refresh(board)
    specs = tools.schemas(board)
    history = [{'role': 'user', 'content': 'Resolve the launch shortage for this case. Start with get_case. Propose options, price them, '
                                           'draft the supplier message and the escalation, recommend one option and queue the approvals.'}]
    done_by_tool, consecutive_bad, calls_made = {}, 0, 0
    partial = failed = False

    def base(choice):
        return {'model': model_name(), 'instructions': labels.AGENT_SYSTEM_PROMPT, 'input': history, 'tools': specs,
                'tool_choice': choice, 'parallel_tool_calls': True, 'store': False, 'reasoning': {'effort': 'low'},
                'max_output_tokens': _budget('LIO_AGENT_MAX_OUTPUT')}

    def handle(call, turn):
        nonlocal consecutive_bad, calls_made
        name = call.get('name') or ''
        calls_made += 1
        board['agent_budget'] = {'calls_left': max(0, budgets['calls'] - calls_made), 'seconds_left': max(0, round(deadline - time.monotonic()))}
        try:
            args = json.loads(call.get('arguments') or '{}')
        except ValueError:
            consecutive_bad += 1
            return tools.reject(board, name, 'The arguments were not valid JSON.', None, turn)
        if name in TOOL_CAPS and done_by_tool.get(name, 0) >= TOOL_CAPS[name]:
            consecutive_bad += 1
            return tools.reject(board, name, 'This tool has reached its limit for the run.', 'Use the results you already have.', turn)
        result = tools.dispatch(board, name, args, turn)
        if result.get('ok'):
            consecutive_bad = 0
            done_by_tool[name] = done_by_tool.get(name, 0) + 1
        else:
            consecutive_bad += 1
        return result

    for turn in range(1, budgets['turns']):
        if deadline - time.monotonic() < 5:
            partial = True
            break
        stop_tools = consecutive_bad >= MAX_CONSECUTIVE_REJECTED or calls_made >= budgets['calls']
        if stop_tools:
            partial = True
            break
        try:
            response = _request(base('auto'), deadline)
        except AgentError:
            failed = True
            break
        outputs = [o for o in (response.get('output') or []) if isinstance(o, dict)]
        mark = len(history)
        history.extend(outputs)
        calls = [o for o in outputs if o.get('type') == 'function_call']
        if not calls:
            break
        for call in calls:
            name = call.get('name') or ''
            result = handle(call, turn)
            history.append({'type': 'function_call_output', 'call_id': call.get('call_id'), 'output': _capped(result, name)})
        _fold(history, mark)
    else:
        partial = True

    # Final structured answer: no more tools; code validates it and writes all prose itself.
    answer = None
    if not failed and deadline - time.monotonic() >= 3:
        payload = base('none')
        payload['text'] = {'format': {'type': 'json_schema', 'name': 'final', 'schema': labels.FINAL_SCHEMA, 'strict': True}}
        try:
            answer = _final_check(board, _text_of(_request(payload, deadline).get('output') or []))
        except AgentError:
            partial = True
    elif not failed:
        partial = True
    board['agent_final'] = answer
    if answer and answer.get('recommended_option_id') is not None and not board.get('recommendation'):
        tools.dispatch(board, 'set_recommendation', {'option_id': answer['recommended_option_id'], 'reasons': ['needs_confirmation']}, budgets['turns'])
    stats['seconds'] = round(time.monotonic() - started, 1)
    if stats.get('actions_ok', 0) < 1:
        board['run_mode'] = 'rule_based'
        return 'fell back'
    board['run_mode'] = 'agent_partial' if (partial or failed) else 'agent'
    return 'needs human review' if board['run_mode'] == 'agent_partial' else 'done'
