import { RefreshCw } from 'lucide-react';
import { m } from 'motion/react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ApproverBadge, Fact, Facts, Label, RiskNote } from '@/components/common';
import { OfferCard } from '@/components/OfferCard';
import { useLaunch } from '@/hooks/useLaunch';
import { useUi } from '@/hooks/useUi';
import { MANUAL_NOTE, approverName, cardLead, cardState, cardTitle, nounOf, recName } from '@/lib/derive';
import { num, timeOnly } from '@/lib/format';
import type { Detail, Overview } from '@/lib/types';

const H = 'm-0 text-[24px] leading-[30px] font-semibold tracking-[-0.01em] text-ink text-balance sm:text-[30px] sm:leading-[38px]';

/* The single decision. One primary button that morphs with the case state. No optimistic UI. */
export function DecisionCard({ d, o }: { d: Detail; o: Overview }) {
  const launch = useLaunch();
  const ui = useUi();
  const c = d.case || {};
  const agent = o.agent || {};
  const aiOn = !!o.integrations?.ai_enabled;
  const emailOn = !!o.integrations?.email_enabled;
  const agentError = !!agent.error;
  const running = launch.busy || !!agent.running;
  const st = cardState(d, agentError, aiOn, emailOn);
  const supplier = d.supplier?.name || 'the supplier';

  if (st.kind === 'offer' && d.offer) return <OfferCard of={d.offer} />;

  const shell = (key: string, children: ReactNode) => (
    <Card data-testid="decision-card" data-demo="decision" data-state={key} aria-label="Your decision" className="border-t border-line pt-8">
      <m.div key={key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }} className="grid gap-4">
        {children}
      </m.div>
    </Card>
  );

  const primary = (label: string, onClick: () => void, opts?: { disabled?: boolean }) => (
    <Button id="approve" data-testid="approve" onClick={onClick} disabled={opts?.disabled || running} className="w-full sm:w-auto sm:justify-self-start">
      {running && !opts?.disabled ? (
        <>
          <RefreshCw className="spin size-4" aria-hidden="true" />
          Working…
        </>
      ) : (
        label
      )}
    </Button>
  );

  const openApproval = async (target: 'supplier' | 'escalation') => {
    if (target === 'supplier' && !c.draft) {
      const ok = await launch.ensureDraft();
      if (!ok) return;
    }
    ui.startApproval(target, 'approve');
  };

  switch (st.kind) {
    case 'no_gap':
      return shell('no_gap', <h2 className={H}>No missing quantity. Check this with Soony.</h2>);
    case 'delivery_unknown':
      return shell('delivery_unknown', <h2 className={H}>Delivery not confirmed. Check sent mail.</h2>);
    case 'sent':
      return shell('sent', <h2 className={H}>Sent. Waiting for {supplier}.</h2>);
    case 'replied':
      return shell(
        'replied',
        <>
          <h2 className={H}>Reply received. Not confirmed yet.</h2>
          <Button data-testid="review-reply" id="approve" className="w-full sm:w-auto sm:justify-self-start" onClick={() => ui.openSheet('offer', 'approve')}>
            Review reply
          </Button>
        </>,
      );
    case 'approved_manual':
      return shell(
        'approved_manual',
        <>
          <h2 className={H}>Approved. Nothing was sent.</h2>
          <p className="m-0 max-w-[64ch] text-ink-2">{MANUAL_NOTE}</p>
          <Label>Approved by {approverName(d)}.</Label>
        </>,
      );
    case 'approved_send':
      return shell(
        'approved_send',
        <>
          <h2 className={H}>Approved. Nothing was sent.</h2>
          <Label>Approved by {approverName(d)}.</Label>
          {primary('Send to supplier', () => ui.openSheet('messages', 'approve'), { disabled: !st.sendEnabled })}
          {!st.sendEnabled ? <p className="m-0 text-[14px] text-ink-3">Sending is off until a sender is registered.</p> : null}
        </>,
      );
    case 'approved_partial':
      return shell(
        'approved_partial',
        <>
          <h2 className={H}>Approved by {approverName(d)}.</h2>
          <p className="m-0 max-w-[64ch] text-ink-2">The message to {d.escalation?.to_role || 'the approver'} still needs your OK.</p>
          {primary('Approve escalation…', () => void openApproval('escalation'))}
        </>,
      );
    default:
      break;
  }

  /* run | approve */
  const title =
    cardTitle(d.brief?.headline || recName(d)) || (d.brief ? "Waiting for the agent's recommendation." : `Ask ${supplier} for the missing ${num(d.shortage)} ${nounOf(d)}.`);
  const lead = cardLead(d.brief?.recommendation);
  const lowConf = d.brief?.confidence === 'low';
  return shell(
    st.kind === 'run' ? `run-${st.label}` : 'approve',
    <>
      <Label>Recommended first step</Label>
      <h2 className={H}>{title}</h2>
      {lead ? <p className="m-0 max-w-[64ch] text-ink-2">{lead}</p> : null}
      {lowConf ? <RiskNote>Low confidence: key facts are unconfirmed.</RiskNote> : null}
      {agentError ? (
        <RiskNote testId="error-note">
          {d.brief ? `Model unavailable. Showing the ${timeOnly(agent.last_run) || 'latest'} result and the rule-based plan.` : 'The agent stopped. Try again.'}
        </RiskNote>
      ) : null}
      {d.brief ? (
        <Facts>
          <Fact label="Approver">
            <ApproverBadge a={d.brief.approver} />
          </Fact>
        </Facts>
      ) : null}
      {st.kind === 'run'
        ? primary(st.label, () => void (st.label === 'Draft the request' ? launch.draftOnly() : launch.runAgent()))
        : primary('Approve…', () => void openApproval('supplier'))}
      {st.kind === 'approve' ? <p className="m-0 text-[14px] leading-5 text-ink-3">Nothing is sent until you confirm the supplier email.</p> : null}
    </>,
  );
}
