import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LazyMotion, domAnimation } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowTracker } from '@/components/WorkflowTracker';
import type { Detail, Overview } from '@/lib/types';

afterEach(cleanup);

const o: Overview = { launch_date: '2026-11-22', issues: [{ id: 'a' }], sync: { last_success: '2026-11-21T12:00:00Z' } };
const view = (d: Detail) =>
  render(
    <LazyMotion features={domAnimation}>
      <WorkflowTracker d={d} o={o} />
    </LazyMotion>,
  );
const events = (n: number) => Array.from({ length: n }, (_, i) => ({ at: `2026-11-21T1${i}:00:00Z`, kind: 'drafted', message: 'Request drafted' }));

describe('WorkflowTracker', () => {
  it('renders the nine stages in order with aria-current on the current one', () => {
    const { container } = view({ id: 'a', title: 'Game cards', shortage: 5, brief: {}, case: { state: 'drafted' } });
    const items = Array.from(container.querySelectorAll('ol > li'));
    expect(items.map((li) => li.getAttribute('data-testid'))).toEqual(
      ['data', 'records', 'problem', 'plan', 'approved', 'sent', 'reply', 'offer', 'trucks'].map((s) => `stage-${s}`),
    );
    const cur = items.filter((li) => li.getAttribute('aria-current') === 'step');
    expect(cur).toHaveLength(1);
    expect(cur[0].textContent).toContain('Approved');
    expect(screen.getByText('Game cards')).toBeTruthy();
  });
  it('headline for approval and for sent by hand', () => {
    view({ id: 'a', shortage: 5, brief: {}, case: { state: 'drafted' } });
    expect(screen.getByTestId('workflow-headline').textContent).toBe('Waiting for your approval');
    cleanup();
    view({ id: 'a', shortage: 5, brief: {}, case: { state: 'sent', sent_at: '2026-11-21T20:42:00Z', sent_manually: true } });
    expect(screen.getByTestId('workflow-headline').textContent).toBe('Sent by hand, waiting for reply');
    expect(screen.getByText('Sent by hand', { selector: 'div' })).toBeTruthy();
  });
  it('shows the estimate and a countdown', () => {
    view({ id: 'a' });
    expect(screen.getByText('Sun 20:00')).toBeTruthy();
    expect(screen.getByTestId('countdown').textContent).toMatch(/left|passed/);
  });
  it('shows placeholders with no events', () => {
    view({ id: 'a', case: {} });
    expect(screen.getAllByText('No updates yet')).toHaveLength(3);
  });
  it('shows the latest 5 and toggles Show all', () => {
    view({ id: 'a', case: {}, events: events(8) });
    expect(screen.getByTestId('history').querySelectorAll('li')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: /Show all 8/ }));
    expect(screen.getByTestId('history').querySelectorAll('li')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');
  });
  it('callout button scrolls to the target and is a safe no-op when absent', () => {
    const d: Detail = { id: 'a', shortage: 5, brief: {}, case: { state: 'drafted' } };
    view(d);
    fireEvent.click(screen.getByRole('button', { name: 'Go to decision' }));
    cleanup();
    const el = document.createElement('div');
    el.id = 'decision';
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    view(d);
    fireEvent.click(screen.getByRole('button', { name: 'Go to decision' }));
    expect(el.scrollIntoView).toHaveBeenCalled();
    el.remove();
  });
  it('never claims delivery', () => {
    for (const d of [
      { id: 'a', case: { state: 'sent', sent_at: 'x' } },
      { id: 'a', case: { state: 'delivery_unknown' } },
      { id: 'a', case: { state: 'offer_reviewed' }, offer: {} },
    ] as Detail[]) {
      const { container } = view(d);
      expect(container.textContent).not.toMatch(/delivered/i);
      cleanup();
    }
  });
  it('renders without crashing on an empty detail', () => {
    expect(() => view({})).not.toThrow();
  });
});
