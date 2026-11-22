import { CircleCheck } from 'lucide-react';
import { Badge, Unknown } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ApproverBadge, Fact, Facts, Label, Money, RiskNote } from '@/components/common';
import { hrs, num } from '@/lib/format';
import type { Offer } from '@/lib/types';

export const offerTitle = (of: Offer) => `Offer reviewed: ${num(of.quantity)} units arrive ${of.arrival_label || 'at a time to be confirmed'}`;

/* a reviewed supplier offer: facts only. There is no order or spend button anywhere. */
export function OfferFacts({ of }: { of: Offer }) {
  return (
    <>
      {of.arrives_before_deadline === false ? (
        <RiskNote>Arrives after the last packing hour</RiskNote>
      ) : of.gap_after_offer != null ? (
        <p className="m-0 rounded-control bg-ok-tint px-3 py-2 text-ok">Gap after offer: {num(of.gap_after_offer)}</p>
      ) : null}
      <Facts>
        <Fact label="Cost">
          {of.cost_eur != null ? <Money v={of.cost_eur} /> : <Unknown />}
          <small className="block text-[13px] text-ink-3">from the supplier reply, not confirmed</small>
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
    <Card data-testid="decision-card" data-demo="offer" aria-label="Your decision" id="decision" className="grid gap-4 scroll-mt-20 border-t-4 border-t-brand">
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn-tint px-2.5 text-[13px] leading-6 font-medium text-warn">
        <CircleCheck className="size-3.5" aria-hidden="true" />
        Offer in, not ordered
      </span>
      <h2 className="m-0 text-[22px] leading-[28px] font-semibold tracking-[-0.01em] text-balance sm:text-[26px] sm:leading-[32px]">{offerTitle(of)}</h2>
      <OfferFacts of={of} />
      {of.simulated ? (
        <div>
          <Badge tone="tag" data-testid="simulated-chip">
            Simulated reply
          </Badge>
        </div>
      ) : null}
      <Label>Nothing is ordered. Stock and orders are unchanged.</Label>
      <Label>{of.approver?.role || 'The approver'} decides on the spend.</Label>
    </Card>
  );
}

export function OfferDetails({ of }: { of: Offer }) {
  return (
    <div className="grid gap-3" data-testid="offer-details">
      <p className="m-0 text-[17px] leading-6 font-semibold text-brand-navy">
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
          <Badge tone="tag">Simulated reply</Badge>
        </div>
      ) : null}
      {of.reviewed_by ? <Label>Reviewed by {of.reviewed_by}.</Label> : null}
      <Label>Nothing is ordered. Stock and orders are unchanged.</Label>
    </div>
  );
}
