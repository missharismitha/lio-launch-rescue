import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { costText, estLine, marginText, TransportSection, verdictText } from '@/components/Transport';
import type { Transport, TransportMode } from '@/lib/types';

afterEach(cleanup);

const mode = (o: Partial<TransportMode> = {}): TransportMode => ({
  mode: 'air',
  route: 'Seoul to Hamburg',
  feasible: true,
  transit_days: 3,
  arrives_at: '2026-11-22T13:00:00Z',
  hours_margin: 14,
  cost_eur: { low: 1500, base: 1800, high: 3200 },
  cost_per_unit_eur: 1.8,
  basis: 'x',
  rank: 1,
  verdict: 'ok',
  ...o,
});
const t = (modes: TransportMode[]): Transport => ({
  estimate: true,
  deadline: '2026-11-22T19:00:00Z',
  lanes: [{ supplier: 'Hwaseong', country: 'South Korea', material: 'cards', quantity: 5000, fastest: 'air', cheapest_feasible: 'air', modes }],
  assumptions: [
    { label: 'Air rate', value: 'EUR 4/kg', source: 'broker', kind: 'market' },
    { label: 'Customs', value: '1 day', source: 'us', kind: 'assumption' },
  ],
  cross_check: { note: 'Within the delivered premium.' },
});

describe('Transport', () => {
  it('renders nothing when absent or empty', () => {
    for (const v of [undefined, null, {}, { lanes: [] }] as (Transport | null | undefined)[]) {
      const r = render(<TransportSection t={v} />);
      expect(r.container.innerHTML).toBe('');
      r.unmount();
    }
  });
  it('formats cost range, labels estimate, shows badges and margin', () => {
    render(<TransportSection t={t([mode()])} />);
    expect(costText(mode())).toMatch(/about EUR.1,800 \(1,500 to 3,200\)/);
    expect(screen.getByText(/^est\. EUR.1,500 to 3,200$/)).toBeTruthy();
    expect(screen.getByText('Fastest')).toBeTruthy();
    expect(screen.getByText('Cheapest')).toBeTruthy();
    expect(screen.getByText('Makes it +14h')).toBeTruthy();
    /* the arrival sentence moved to the tile title/aria-label */
    expect(screen.getByTestId('transport-mode').getAttribute('title')).toMatch(/arrives .*makes it, 14.h to spare/);
    expect(screen.queryByTestId('transport-none')).toBeNull();
  });
  it('negative margin reads as late; no-feasible lane says so', () => {
    const m = mode({ feasible: false, hours_margin: -72, verdict: 'Too slow' });
    expect(marginText(m)).toMatch(/3 days late/);
    expect(marginText(mode({ feasible: false, hours_margin: -5 }))).toMatch(/5.h late/);
    render(<TransportSection t={t([m])} />);
    expect(screen.getByTestId('transport-none').textContent).toBe('No mode makes Sunday 20:00');
    expect(screen.queryByText('Cheapest')).toBeNull();
    expect(screen.getByTestId('transport-mode').getAttribute('title')).toMatch(/Too slow/);
  });
  it('states lateness once per lane, no duplicate sentence', () => {
    const m = mode({ feasible: false, hours_margin: -90, verdict: 'Too slow' });
    render(<TransportSection t={t([m])} />);
    const lane = screen.getByTestId('transport-lane');
    expect(within(lane).getAllByText('Late 4d').length).toBe(1);
    expect(lane.textContent).not.toMatch(/Too late|days late|too late by/i);
    expect(lane.textContent).not.toMatch(/arrives/);
  });
  it('verdict and est. line helpers', () => {
    expect(verdictText(mode({ hours_margin: 5 }))).toBe('Makes it +5h');
    expect(verdictText(mode({ feasible: false, hours_margin: -5 }))).toBe('Late 5h');
    expect(verdictText(mode({ feasible: false, hours_margin: null }))).toBe('Late');
    expect(estLine(mode({ cost_eur: null }))).toBe('');
    expect(estLine(mode({ cost_eur: { low: 900, base: 900, high: 900 } }))).toMatch(/^est\. EUR.900$/);
  });
  it('shows assumptions with kind labels and the confirm line', () => {
    render(<TransportSection t={t([mode()])} />);
    expect(screen.getByText(/Market rate/)).toBeTruthy();
    expect(screen.getByText(/Our assumption/)).toBeTruthy();
    expect(screen.getByText('Within the delivered premium.')).toBeTruthy();
    expect(screen.getByText('Estimates, not customer data. Confirm freight rates with Soony logistics.')).toBeTruthy();
  });
  it('costText tolerates missing and equal bounds', () => {
    expect(costText(mode({ cost_eur: null }))).toBe('');
    expect(costText(mode({ cost_eur: { low: 900, base: 900, high: 900 } }))).toMatch(/^about EUR.900$/);
  });
});
