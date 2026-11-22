import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { LazyMotion, domAnimation } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentLive, resetAutoStartForTests } from '@/components/AgentLive';
import { LaunchContext, type Launch } from '@/hooks/useLaunch';
import type { Detail, Overview } from '@/lib/types';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(resetAutoStartForTests);

const launch = (over: Partial<Launch> = {}): Launch => {
  const noop = vi.fn(async () => true);
  return {
    status: 'ready', overview: null, detail: null, selected: 'x', busy: false,
    selectCase: vi.fn(), retry: vi.fn(), act: noop, runAgent: noop, draftOnly: noop, sendMail: noop, syncNow: noop,
    approve: noop, reviewReply: noop, ensureDraft: noop, ...over,
  };
};
const ui = (d: Detail, o: Overview, autoStart: boolean, l: Launch) => (
  <LazyMotion features={domAnimation}>
    <LaunchContext.Provider value={l}>
      <AgentLive d={d} o={o} autoStart={autoStart} />
    </LaunchContext.Provider>
  </LazyMotion>
);
const view = (d: Detail, o: Overview, autoStart = false, l: Launch = launch()) => render(ui(d, o, autoStart, l));

const finished: Detail = {
  id: 'c1', shortage: 10, run_mode: 'agent', agent: { tool_calls: 13, rejected: 2, seconds: 21 },
  brief: { headline: 'Release the hold. Then wait.' }, case: {},
  trace: [
    { step: '1', tool: 'Read the case', outcome: 'done', autonomy: 'auto', summary: 'Shortage 10', by: 'agent' },
    { step: '2', tool: 'Priced an option', outcome: 'done', autonomy: 'auto', summary: 'EUR 100', by: 'agent' },
    { step: '3', tool: 'Priced an option', outcome: 'done', autonomy: 'auto', summary: 'EUR 200', by: 'agent' },
    { step: '4', tool: 'Send email', outcome: 'rejected', autonomy: 'never', summary: 'Not allowed', by: 'agent' },
    { step: '5', tool: 'Queued for approval', outcome: 'needs approval', autonomy: 'approval', summary: 'Supplier message', by: 'agent' },
  ],
};

describe('AgentLive', () => {
  it('shows streamed steps while running, last one working', () => {
    const o: Overview = { agent: { running: true, steps: [{ message: 'Reading the records' }, { message: 'Searched the records' }] } };
    const { getAllByTestId, getByTestId, getByText } = view({ id: 'c1', trace: [] }, o);
    fireEvent.click(getByText('Show all steps'));
    const rows = getAllByTestId('agent-step');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-state')).toBe('done');
    expect(rows[1].getAttribute('data-state')).toBe('running');
    expect(getByTestId('agent-status').textContent).toContain('Working');
    expect(getByTestId('agent-count').textContent).toBe('2 steps');
  });
  it('uses the last run length for "n of ~m" while running', () => {
    const o: Overview = { agent: { running: true, steps: [{ message: 'Read the case' }] } };
    const { getByTestId } = view(finished, o);
    expect(getByTestId('agent-count').textContent).toBe('1 of ~13');
  });
  it('renders finished trace rows, grouped, with counters and verdict', () => {
    const { getAllByTestId, getByTestId, queryByTestId, getByText } = view(finished, { agent: {}, integrations: { ai_enabled: true } });
    fireEvent.click(getByText('Show all steps'));
    const rows = getAllByTestId('agent-step');
    expect(rows).toHaveLength(4);
    expect(rows[1].textContent).toContain('Pricing x2');
    expect(rows[2].getAttribute('data-state')).toBe('rejected');
    expect(rows[3].getAttribute('data-state')).toBe('approval');
    expect(getByTestId('agent-calls').textContent).toBe('13 calls');
    expect(getByTestId('agent-blocked').textContent).toBe('2 blocked');
    expect(getByTestId('agent-mode').textContent).toBe('Model chose the tools');
    expect(getByTestId('agent-seconds').textContent).toBe('21s');
    expect(getByTestId('agent-status').textContent).toBe('Needs you');
    expect(getByTestId('agent-verdict').textContent).toContain('Release the hold');
    expect(getByTestId('agent-verdict').textContent).toContain('Needs your approval');
    expect(queryByTestId('agent-empty')).toBeNull();
  });
  it('the approval button scrolls to #decision and is a no-op when absent', () => {
    const { getByText } = view(finished, { agent: {} });
    expect(() => fireEvent.click(getByText('Needs your approval'))).not.toThrow();
    const el = document.createElement('div');
    el.id = 'decision';
    const spy = vi.fn();
    el.scrollIntoView = spy;
    document.body.appendChild(el);
    fireEvent.click(getByText('Needs your approval'));
    expect(spy).toHaveBeenCalled();
    el.remove();
  });
  it('expands a step to show the autonomy chip', () => {
    const { getAllByTestId, queryByTestId, getAllByRole, getByText } = view(finished, { agent: {} });
    fireEvent.click(getByText('Show all steps'));
    expect(queryByTestId('agent-step-detail')).toBeNull();
    const btn = getAllByRole('button', { expanded: false }).find((b) => b.closest('[data-testid="agent-steps"]'))!;
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const detail = getAllByTestId('agent-step-detail')[0];
    expect(detail.textContent).toContain('Auto');
    expect(detail.textContent).toContain('Shortage 10');
  });
  it('rules only run is labelled honestly and hides blocked when zero', () => {
    const d: Detail = {
      id: 'c1', run_mode: 'rule_based', agent: { tool_calls: 0, rejected: 0 },
      trace: [{ agent: 'Reconciler', action: 'Recomputed the shortage from the records', outcome: 'done', autonomy: 'auto' }],
    };
    const { getByTestId, queryByTestId } = view(d, { agent: {} });
    expect(getByTestId('agent-mode').textContent).toBe('Rules only');
    expect(queryByTestId('agent-blocked')).toBeNull();
    expect(getByTestId('agent-status').textContent).toBe('Done');
  });
  it('keeps streamed rows until the trace arrives, then swaps without remounting', () => {
    const steps = [{ message: 'Reading the records' }, { message: 'Weighing the options' }];
    const d0: Detail = { id: 'c1', shortage: 10, trace: [] };
    const l = launch();
    const r = render(ui(d0, { agent: { running: true, steps } }, false, l));
    fireEvent.click(r.getByText('Show all steps'));
    const first = r.getAllByTestId('agent-step')[0];
    r.rerender(ui(d0, { agent: { running: false, steps } }, false, l));
    expect(r.getAllByTestId('agent-step')).toHaveLength(2);
    r.rerender(ui(finished, { agent: { running: false, steps } }, false, l));
    expect(r.getAllByTestId('agent-step')).toHaveLength(4);
    expect(r.getAllByTestId('agent-step')[0]).toBe(first);
  });
  it('error shows a retry that reruns once per click, never automatically', () => {
    const runAgent = vi.fn(async () => true);
    const { getByText } = view({ id: 'c1', shortage: 10, trace: [] }, { agent: { error: 'x' } }, true, launch({ runAgent }));
    expect(runAgent).not.toHaveBeenCalled();
    fireEvent.click(getByText('Retry'));
    expect(runAgent).toHaveBeenCalledTimes(1);
  });
  it('empty idle state, run button is labelled', () => {
    const { getByTestId, getByLabelText } = view({ id: 'c1', shortage: 10, trace: [] }, { agent: {} });
    expect(getByTestId('agent-empty')).toBeTruthy();
    expect(getByLabelText('Run agent')).toBeTruthy();
  });
  it('auto start fires once after about a second', () => {
    vi.useFakeTimers();
    const runAgent = vi.fn(async () => true);
    const d: Detail = { id: 'c9', shortage: 10, trace: [] };
    const l = launch({ runAgent });
    const r = render(ui(d, { agent: {} }, true, l));
    expect(r.getByTestId('agent-status').textContent).toBe('Starting');
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
    r.rerender(ui(d, { agent: {} }, true, launch({ runAgent })));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
  });
  it('finished panel is compact: pipeline, verdict, no step rows, height class', () => {
    const { getByTestId, getAllByTestId, queryByTestId, getByText } = view(finished, { agent: {} });
    expect(getAllByTestId('agent-phase')).toHaveLength(6);
    expect(queryByTestId('agent-steps')).toBeNull();
    expect(queryByTestId('agent-phase-panel')).toBeNull();
    expect(getByTestId('agent-live').className).toContain('sm:max-h-[260px]');
    fireEvent.click(getByText('Show all steps'));
    expect(getByTestId('agent-live').className).not.toContain('sm:max-h-[260px]');
  });
  it('phase chips show counts and states (guard rail, approval hand)', () => {
    const { getAllByTestId } = view(finished, { agent: {} });
    const by = (k: string) => getAllByTestId('agent-phase').find((b) => b.getAttribute('data-phase') === k)!;
    expect(by('read').getAttribute('data-state')).toBe('done');
    expect(by('compare').textContent).toContain('2');
    expect(by('rules').getAttribute('data-state')).toBe('guard');
    expect(by('decide').getAttribute('data-state')).toBe('approval');
    expect(by('find').getAttribute('data-state')).toBe('waiting');
    expect((by('find') as HTMLButtonElement).disabled).toBe(true);
  });
  it('clicking a phase opens only its steps; one at a time; Escape closes', () => {
    const { getAllByTestId, getByTestId, queryByTestId } = view(finished, { agent: {} });
    const by = (k: string) => getAllByTestId('agent-phase').find((b) => b.getAttribute('data-phase') === k)!;
    fireEvent.click(by('compare'));
    expect(getByTestId('agent-phase-panel').getAttribute('data-phase')).toBe('compare');
    expect(getAllByTestId('phase-step')).toHaveLength(1);
    expect(getByTestId('agent-phase-panel').textContent).toContain('Pricing x2');
    fireEvent.click(by('decide'));
    expect(getAllByTestId('agent-phase-panel')).toHaveLength(1);
    expect(getByTestId('agent-phase-panel').getAttribute('data-phase')).toBe('decide');
    expect(by('decide').getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByTestId('agent-phase-panel')).toBeNull();
    fireEvent.click(by('decide'));
    fireEvent.click(by('decide'));
    expect(queryByTestId('agent-phase-panel')).toBeNull();
  });
  it('streamed rows fill phases in order and show a short now line', () => {
    const msgs = ['Read the case', 'Looked for supplier holds', 'Compared transport modes'].map((message) => ({ message }));
    const l = launch();
    const r = render(ui({ id: 'c1', trace: [] }, { agent: { running: true, steps: msgs.slice(0, 1) } }, false, l));
    const state = (k: string) => r.getAllByTestId('agent-phase').find((b) => b.getAttribute('data-phase') === k)!.getAttribute('data-state');
    expect(state('read')).toBe('running');
    expect(state('find')).toBe('waiting');
    r.rerender(ui({ id: 'c1', trace: [] }, { agent: { running: true, steps: msgs } }, false, l));
    expect(state('read')).toBe('done');
    expect(state('find')).toBe('done');
    expect(state('compare')).toBe('running');
    expect(state('rules')).toBe('waiting');
    expect(r.getByTestId('agent-now').textContent).toBe('Comparing transport modes');
    expect(r.getAllByTestId('agent-link').map((x) => x.getAttribute('data-filled'))).toEqual(['true', 'true', 'false', 'false', 'false']);
  });
  it('skip cancels the pending start', () => {
    vi.useFakeTimers();
    const runAgent = vi.fn(async () => true);
    const { getByText } = view({ id: 'c8', shortage: 10, trace: [] }, { agent: {} }, true, launch({ runAgent }));
    fireEvent.click(getByText('Skip'));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(runAgent).not.toHaveBeenCalled();
  });
});
