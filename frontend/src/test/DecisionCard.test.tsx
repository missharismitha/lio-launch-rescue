import { cleanup, render } from '@testing-library/react';
import { LazyMotion, domAnimation } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecisionCard } from '@/components/DecisionCard';
import { LaunchContext, type Launch } from '@/hooks/useLaunch';
import { UiProvider } from '@/hooks/useUi';
import type { Detail, Overview } from '@/lib/types';

afterEach(cleanup);

const noop = vi.fn(async () => true);
const launch = (over: Partial<Launch> = {}): Launch => ({
  status: 'ready', overview: null, detail: null, selected: 'x', busy: false,
  selectCase: vi.fn(), retry: vi.fn(), act: noop, runAgent: noop, draftOnly: noop, sendMail: noop, syncNow: noop,
  approve: noop, reviewReply: noop, ensureDraft: noop, ...over,
});

function view(d: Detail, o: Overview = { integrations: { ai_enabled: true, email_enabled: false }, agent: {} }, l: Launch = launch()) {
  return render(
    <LazyMotion features={domAnimation}>
      <LaunchContext.Provider value={l}>
        <UiProvider>
          <DecisionCard d={d} o={o} />
        </UiProvider>
      </LaunchContext.Provider>
    </LazyMotion>,
  );
}
const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).map((b) => b.textContent?.trim());

describe('DecisionCard state to button', () => {
  it('idle shows Run agent', () => {
    const { container } = view({ shortage: 10, case: {}, supplier: { name: 'S' } });
    expect(buttons(container)).toEqual(['Run agent']);
  });
  it('running disables the button and says Working', () => {
    const { container } = view({ shortage: 10, case: {} }, { integrations: { ai_enabled: true }, agent: { running: true } });
    const b = container.querySelector('button')!;
    expect(b.disabled).toBe(true);
    expect(b.textContent).toContain('Working');
  });
  it('drafted shows Approve…', () => {
    const { container } = view({ shortage: 10, case: { draft: { subject: 's', body: 'b' } }, brief: { headline: 'Release the hold. Then wait.', approver: { role: 'Head', name: 'Ann' } } });
    expect(buttons(container)).toEqual(['Approve…']);
    expect(container.textContent).toContain('Release the hold');
    expect(container.textContent).not.toContain('Then wait');
  });
  it('approved shows no send claim and only the hand-off button when manual', () => {
    const { container } = view({ shortage: 10, case: { approved: true, draft: { manual_send: true } }, brief: {} });
    expect(buttons(container)).toEqual(['Send it yourself…']);
    expect(container.textContent).toContain('Approved. Nothing was sent.');
    expect(container.textContent).toContain('Send this one yourself from your own mail after approval.');
  });
  it('delivery_unknown has text and no button', () => {
    const { container } = view({ shortage: 10, case: { state: 'delivery_unknown', draft: {} }, brief: {} });
    expect(container.textContent).toContain('Delivery not confirmed. Check sent mail.');
    expect(buttons(container)).toEqual([]);
  });
  it('reply received offers Review reply', () => {
    const { container } = view({ shortage: 10, case: { sent_at: 'x' }, replies: [{ id: '1' }] });
    expect(buttons(container)).toEqual(['Review reply']);
  });
  it('error offers Retry and low confidence is stated plainly', () => {
    const { container } = view({ shortage: 10, case: {} }, { integrations: { ai_enabled: true }, agent: { error: 'x' } });
    expect(buttons(container)).toEqual(['Retry']);
    const low = view({ shortage: 10, case: {}, brief: { headline: 'H', confidence: 'low' } });
    expect(low.container.textContent).toContain('Low confidence: key facts are unconfirmed.');
  });
  it('has no order or spend button in any state', () => {
    const states: Detail[] = [
      { shortage: 1, case: {} }, { shortage: 1, case: {}, brief: {} }, { shortage: 1, case: { approved: true, draft: {} }, brief: {} },
      { shortage: 1, case: { sent_at: 'x' } }, { shortage: 1, offer: { quantity: 1 } },
    ];
    for (const d of states) {
      const { container, unmount } = view(d);
      expect(container.textContent).not.toMatch(/\b(order now|buy|pay)\b/i);
      unmount();
    }
  });
});
