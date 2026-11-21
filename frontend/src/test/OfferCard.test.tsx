import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OfferCard } from '@/components/OfferCard';

afterEach(cleanup);

describe('OfferCard', () => {
  it('shows the Simulated chip and the no-order notes', () => {
    const { container } = render(
      <OfferCard of={{ quantity: 6800, arrival_label: 'Sun 02:30', cost_eur: 21400, gap_after_offer: 0, simulated: true, approver: { role: 'Category Lead', name: 'T. B', provisional: true } }} />,
    );
    const t = container.textContent || '';
    expect(t).toContain('Offer reviewed: 6,800 units arrive Sun 02:30');
    expect(t).toContain('Simulated reply');
    expect(t).toContain('from the supplier reply, not confirmed');
    expect(t).toContain('Nothing is ordered. Stock and orders are unchanged.');
    expect(t).toContain('Category Lead decides on the spend.');
    expect(container.querySelectorAll('button').length).toBe(0);
  });
  it('null fields stay unknown or neutral, never invented', () => {
    const { container } = render(<OfferCard of={{ quantity: null, arrival_label: null, cost_eur: null, approver: null }} />);
    const t = container.textContent || '';
    expect(t).toContain('arrive at a time to be confirmed');
    expect(t).toContain('unknown');
    expect(t).not.toContain('Simulated reply');
    expect(t).toContain('The approver decides on the spend.');
  });
  it('says plainly when the offer arrives too late', () => {
    const { container } = render(<OfferCard of={{ quantity: 10, arrives_before_deadline: false }} />);
    expect(container.textContent).toContain('Arrives after the last packing hour');
  });
});
