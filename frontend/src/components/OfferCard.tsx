import { Badge, Unknown } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ApproverBadge, Fact, Facts, Money } from '@/components/common';
import { hrs, num } from '@/lib/format';
import type { Offer } from '@/lib/types';

export const offerTitle = (of: Offer) => `Offer reviewed: ${num(of.quantity)} units arrive ${of.arrival_label || 'at a time to be confirmed'}`;

/* a reviewed supplier offer: facts only. There is no order or spend button anywhere. */
export function OfferFacts({ of }: { of: Offer }) {
  return (
    <>
      {of.arrives_before_deadline === false ? (
        <p className="m-0 font-semibold text-risk">Arrives after the last packing hour</p>
      ) : of.gap_after_offer != null ? (
        <p className="m-0">Gap after offer: {num(of.gap_after_offer)}</p>
      ) : null}
      <Facts>
        <Fact label="Cost">
          {of.cost_eur != null ? <Money v={of.cost_eur} /> : <Unknown />}
          <small className="block text-[13px] font-normal text-ink-2">from the supplier reply, not confirmed</small>
        </Fact>
        <Fact label="Approver">
          <ApproverBadge a={of.approver} />
        </Fact>
      </Facts>
    </>
  );
}

export function OfferCard({ of }: { of: Offer }) {
  return (
    <Card data-testid="decision-card" data-demo="offer" aria-label="Your decision" className="hairline grid gap-3 p-5 sm:p-6">
      <h2 className="m-0 text-[22px] leading-7 font-semibold">{offerTitle(of)}</h2>
      <OfferFacts of={of} />
      {of.simulated ? (
        <div>
          <Badge tone="neutral" data-testid="simulated-chip">
            Simulated reply
          </Badge>
        </div>
      ) : null}
      <p className="m-0 text-[13px] text-ink-2">Nothing is ordered. Stock and orders are unchanged.</p>
      <p className="m-0 text-[13px] text-ink-2">{of.approver?.role || 'The approver'} decides on the spend.</p>
    </Card>
  );
}

export function OfferDetails({ of }: { of: Offer }) {
  return (
    <div className="grid gap-3" data-testid="offer-details">
      <p className="m-0 text-[17px] font-semibold">
        {num(of.quantity)} units arrive {of.arrival_label || 'at a time to be confirmed'}.
      </p>
      <OfferFacts of={of} />
      {of.extra_units_short_edition != null ? (
        <p className="m-0">
          Up to {num(of.extra_units_short_edition)} more copies of the short edition could be packed
          {of.packing_hours_after_arrival != null ? ` in ${hrs(of.packing_hours_after_arrival)} after arrival` : ''}.
        </p>
      ) : null}
      {of.simulated ? (
        <div>
          <Badge>Simulated reply</Badge>
        </div>
      ) : null}
      {of.reviewed_by ? <p className="m-0 text-[13px] text-ink-2">Reviewed by {of.reviewed_by}.</p> : null}
      <p className="m-0 text-[13px] text-ink-2">Nothing is ordered. Stock and orders are unchanged.</p>
    </div>
  );
}
