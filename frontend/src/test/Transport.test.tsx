import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { costText, marginText, TransportSection } from '@/components/Transport';
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
    expect(screen.getByText(/about EUR.1,800 \(1,500 to 3,200\)/)).toBeTruthy();
    expect(screen.getAllByText('Estimate:').length).toBe(1);
    expect(screen.getByText('Fastest')).toBeTruthy();
    expect(screen.getByText('Cheapest that makes it')).toBeTruthy();
    expect(screen.getByText(/makes it, 14.h to spare/)).toBeTruthy();
    expect(screen.queryByTestId('transport-none')).toBeNull();
  });
  it('negative margin reads as late; no-feasible lane says so', () => {
    const m = mode({ feasible: false, hours_margin: -72, verdict: 'Too slow' });
    expect(marginText(m)).toMatch(/3 days late/);
    expect(marginText(mode({ feasible: false, hours_margin: -5 }))).toMatch(/5.h late/);
    render(<TransportSection t={t([m])} />);
    expect(screen.getByTestId('transport-none').textContent).toMatch(/No transport mode arrives before Sunday 20:00\. Fastest: air, 3 days late/);
    expect(screen.queryByText('Cheapest that makes it')).toBeNull();
    expect(screen.getByText('Too slow')).toBeTruthy();
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
