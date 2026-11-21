import { Printer, RefreshCw, LogOut, Sparkles, Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge, Dot, Unknown } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AgentRail } from '@/components/AgentRail';
import { ApprovalFlow } from '@/components/ApprovalFlow';
import { ApproverBadge, Fact, Facts, Money, RiskNote, SheetSection } from '@/components/common';
import { OfferDetails } from '@/components/OfferCard';
import { HoldNote, OptionList } from '@/components/Options';
import { useLaunch } from '@/hooks/useLaunch';
import { useUi, type TabId } from '@/hooks/useUi';
import { useWhatIf } from '@/hooks/useWhatIf';
import { api } from '@/lib/api';
import { MANUAL_NOTE, SENT_BY_HAND, approverName, briefGains, recOption } from '@/lib/derive';
import { cap, eur, etaText, num, timeOnly } from '@/lib/format';
import type { Detail, Overview } from '@/lib/types';

function MailBox({ subject, body, testId }: { subject?: string; body?: string; testId: string }) {
  return (
    <div data-testid={testId} className="overflow-hidden rounded-control border border-line bg-white">
      <p className="m-0 border-b border-line px-3 py-2 text-[14px]">
        <b>Subject: </b>
        {subject || ''}
      </p>
      <pre className="m-0 max-h-64 overflow-auto p-3 font-sans text-[14px] leading-5 whitespace-pre-wrap">{body || ''}</pre>
    </div>
  );
}

function BriefTab({ d }: { d: Detail }) {
  const b = d.brief;
  if (!b) return <SheetSection title="Decision brief"><p className="m-0 text-ink-2">No decision brief yet.</p></SheetSection>;
  const opt = recOption(d);
  const gains = briefGains(d);
  const conf = b.confidence;
  return (
    <>
      <SheetSection title="Decision brief" testId="brief">
        <p className="m-0 text-[17px] leading-6 font-semibold">{b.recommendation || 'No recommendation yet.'}</p>
        <Facts>
          <Fact label="Fix costs">{b.price_eur != null ? <Money v={b.price_eur} /> : <Unknown />}</Fact>
          <Fact label="Approver"><ApproverBadge a={b.approver} /></Fact>
          {gains != null ? (
            <Fact label="Copies gained"><span className="num">{num(gains)}</span></Fact>
          ) : (
            <Fact label="Arrives">{opt?.eta ? etaText(opt.eta) : <Unknown />}</Fact>
          )}
          {b.deadline ? <Fact label="Deadline">{b.deadline}</Fact> : null}
        </Facts>
        {conf ? (
          <div>
            <Badge tone={conf === 'high' ? 'ok' : 'neutral'}>
              <Dot />
              {cap(conf)} confidence
            </Badge>
          </div>
        ) : null}
        {conf === 'low' ? <RiskNote>Low confidence: key facts are unconfirmed.</RiskNote> : null}
        {(b.risks || []).length ? (
          <>
            <h4 className="m-0 text-[14px] font-semibold text-ink-2">Risks</h4>
            <ul className="m-0 list-disc pl-5">{b.risks!.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </>
        ) : null}
        {(b.verify_next || []).length ? (
          <>
            <h4 className="m-0 text-[14px] font-semibold text-ink-2">{conf === 'low' ? 'What to confirm first' : "What I'd verify next"}</h4>
            <ul className="m-0 list-disc pl-5" data-testid="verify-next">{b.verify_next!.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </>
        ) : null}
        {d.value?.claim_eur != null ? <p className="m-0 text-[14px] text-ink-2">A late-delivery claim of about {eur(d.value.claim_eur)} may apply. Legal decides.</p> : null}
        {d.value?.headline_eur != null ? (
          <p className="m-0 text-[14px] text-ink-2">
            {d.value.basis === 'cost' || !d.value.basis
              ? `About ${eur(d.value.headline_eur)} of product cost short (cost basis, not price).`
              : `About ${eur(d.value.headline_eur)} at stake${d.value.label ? ` (${d.value.label})` : ''}.`}
          </p>
        ) : null}
      </SheetSection>
      {(d.holds || []).length ? <HoldNote d={d} /> : null}
      {(d.options || []).length ? (
        <SheetSection title="Options">
          <OptionList d={d} expanded />
        </SheetSection>
      ) : null}
      <div>
        <Button variant="secondary" size="sm" data-testid="brief-print" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden="true" />
          Print one-page brief
        </Button>
      </div>
    </>
  );
}

function NumbersTab({ d, o }: { d: Detail; o: Overview }) {
  const w = useWhatIf();
  const ok = d.numbers_verified === true;
  const rows: [string, number | undefined][] = [
    ['Needed', d.required],
    ['In stock (estimate)', d.usable_stock],
    ['Arriving before launch', d.incoming],
    ['Missing', d.shortage],
  ];
  void o;
  return (
    <SheetSection title="Numbers" testId="numbers">
      <div data-testid="numbers-badge">
        {ok ? (
          <Badge tone="ok"><Check className="size-3.5" aria-hidden="true" />Numbers verified</Badge>
        ) : (
          <Badge tone="warn"><Dot />Numbers not verified</Badge>
        )}
      </div>
      <Facts>
        {rows.map(([k, v]) => (
          <Fact key={k} label={k}>
            <span className="num">{num(v) || 'unknown'}</span>
          </Fact>
        ))}
      </Facts>
      {(d.conflicts || []).length ? (
        <>
          <h4 className="m-0 text-[14px] font-semibold text-ink-2">Records that disagree</h4>
          {d.conflicts!.map((x, i) => (
            <div key={i} className="grid gap-0.5 border-l-2 border-line pl-3">
              <b>{x.field || 'Record'}</b>
              <span>{x.why || ''}</span>
              {x.confidence ? <span className="text-[14px] text-ink-2">{cap(x.confidence)} confidence</span> : null}
            </div>
          ))}
        </>
      ) : null}
      {w.available ? (
        <div className="grid gap-1">
          <label htmlFor="whatif-text" className="text-[14px] font-semibold">Parts arrive in (hours, 0 to 72)</label>
          <input
            id="whatif-text"
            type="number"
            inputMode="numeric"
            min={0}
            max={72}
            step={1}
            value={w.hours}
            onChange={(e) => e.target.value !== '' && w.setHours(Number(e.target.value))}
            className="min-h-11 w-28 rounded-control border border-line-2 bg-white px-3"
          />
          <p className="m-0 text-[14px]" aria-live="polite">{w.sentence}</p>
        </div>
      ) : null}
    </SheetSection>
  );
}

function MessagesTab({ d, o }: { d: Detail; o: Overview }) {
  const launch = useLaunch();
  const ui = useUi();
  const c = d.case || {};
  const dr = c.draft;
  const esc = d.escalation;
  const emailOn = !!o.integrations?.email_enabled;
  const supplierApproved = !!(dr && c.approved);
  const all = supplierApproved && !(esc && !esc.approved);
  const extra = (d.supplier_drafts || []).filter((x) => x && x.body && !(dr && x.subject === dr.subject));
  const target = ui.approval;
  return (
    <>
      <SheetSection title={`To ${d.supplier?.name || 'the supplier'}`}>
        {dr ? (
          <MailBox subject={dr.subject} body={dr.body} testId="draft-supplier" />
        ) : (
          <>
            <p className="m-0 text-ink-2">No request yet.</p>
            <div><Button size="sm" variant="secondary" disabled={launch.busy} onClick={() => void launch.draftOnly()}>Create the request</Button></div>
          </>
        )}
        {dr && !supplierApproved && !c.sent_at && target !== 'supplier' ? (
          <div><Button size="sm" data-testid="approve-open" disabled={launch.busy} onClick={() => ui.startApproval('supplier', 'details')}>Approve…</Button></div>
        ) : null}
        {target === 'supplier' && dr ? <ApprovalFlow target="supplier" d={d} /> : null}
        {supplierApproved ? (
          <div><Badge tone="ok"><Check className="size-3.5" aria-hidden="true" />Approved by {approverName(d)}</Badge></div>
        ) : null}
      </SheetSection>
      {extra.map((x, i) => (
        <SheetSection key={i} title={`To ${x.supplier || 'another supplier'}`}>
          <MailBox subject={x.subject} body={x.body} testId="draft-supplier-extra" />
          <p className="m-0 text-[14px] text-ink-2">Draft only. Nothing is sent from here.</p>
        </SheetSection>
      ))}
      {esc ? (
        <SheetSection title={`To ${esc.to_role || 'the approver'}`}>
          <MailBox subject={esc.subject} body={esc.body} testId="draft-escalation" />
          {supplierApproved && !esc.approved && target !== 'escalation' ? (
            <div><Button size="sm" data-testid="approve-escalation" disabled={launch.busy} onClick={() => ui.startApproval('escalation', 'details')}>Approve escalation…</Button></div>
          ) : null}
          {target === 'escalation' ? <ApprovalFlow target="escalation" d={d} /> : null}
          {esc.approved ? <div><Badge tone="ok"><Check className="size-3.5" aria-hidden="true" />Approved</Badge></div> : null}
        </SheetSection>
      ) : null}
      {c.sent_at ? (
        <p className="m-0 text-ink-2">{c.sent_manually ? `${SENT_BY_HAND}.` : "Sent."}</p>
      ) : all ? (
        <div className="grid gap-2">
          {c.draft?.manual_send ? (
            <p className="m-0">{MANUAL_NOTE}</p>
          ) : (
            <>
              <div><Button size="sm" id="send-btn" disabled={!emailOn || launch.busy} onClick={() => void launch.sendMail()}>Send to supplier</Button></div>
              {!emailOn ? <p className="m-0 text-[14px] text-ink-2">Sending is off. No sender is registered yet.</p> : null}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

function ReviewForm({ d }: { d: Detail }) {
  const launch = useLaunch();
  const replies = d.replies || [];
  const [reply, setReply] = useState(replies[replies.length - 1]?.id || '');
  const [qty, setQty] = useState('');
  const [arrival, setArrival] = useState('');
  const [cost, setCost] = useState('');
  const [who, setWho] = useState(d.case?.approver || '');
  const [note, setNote] = useState('');
  const arrivalDate = arrival ? new Date(arrival) : null;
  const valid = !!reply && qty !== '' && Number(qty) >= 0 && !!arrivalDate && !Number.isNaN(arrivalDate.getTime()) && cost !== '' && Number(cost) >= 0 && who.trim().length >= 2 && note.trim().length >= 5;
  const field = 'min-h-11 rounded-control border border-line-2 bg-white px-3';
  const L = ({ id, children }: { id: string; children: ReactNode }) => <label htmlFor={id} className="text-[14px] font-semibold">{children}</label>;
  return (
    <SheetSection title="Review the supplier reply" testId="review-form">
      <p className="m-0 text-ink-2">Type what the supplier wrote in their reply. This records an offer for review. Nothing is ordered.</p>
      {replies.length > 1 ? (
        <div className="grid gap-1">
          <L id="rv-reply">Reply</L>
          <select id="rv-reply" value={reply} onChange={(e) => setReply(e.target.value)} className={field}>
            {replies.map((r, i) => <option key={r.id} value={r.id}>{`Reply ${i + 1}${r.simulated ? ' (simulated)' : ''}`}</option>)}
          </select>
        </div>
      ) : null}
      <div className="grid gap-1"><L id="rv-qty">Units offered</L><input id="rv-qty" type="number" inputMode="numeric" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className={field} /></div>
      <div className="grid gap-1"><L id="rv-arr">Arrival</L><input id="rv-arr" type="datetime-local" value={arrival} onChange={(e) => setArrival(e.target.value)} className={field} /></div>
      <div className="grid gap-1"><L id="rv-cost">Cost in EUR</L><input id="rv-cost" type="number" inputMode="decimal" min={0} value={cost} onChange={(e) => setCost(e.target.value)} className={field} /></div>
      <div className="grid gap-1"><L id="rv-who">Your name</L><input id="rv-who" value={who} onChange={(e) => setWho(e.target.value)} className={field} /></div>
      <div className="grid gap-1"><L id="rv-note">What you checked</L><input id="rv-note" value={note} onChange={(e) => setNote(e.target.value)} className={field} /></div>
      <div>
        <Button
          size="sm"
          disabled={!valid || launch.busy}
          data-testid="review-submit"
          onClick={() =>
            void launch.reviewReply({ message_id: reply, reviewer: who.trim(), quantity: Math.round(Number(qty)), arrival_at: arrivalDate!.toISOString(), cost_eur: Number(cost), note: note.trim() })
          }
        >
          Record reviewed offer
        </Button>
      </div>
    </SheetSection>
  );
}

function OfferTab({ d }: { d: Detail }) {
  if (d.offer) return <SheetSection title="Reviewed offer"><OfferDetails of={d.offer} /></SheetSection>;
  if ((d.replies || []).length) return <ReviewForm d={d} />;
  return <SheetSection title="Reviewed offer"><p className="m-0 text-ink-2">No supplier reply yet.</p></SheetSection>;
}

function HealthTab({ o }: { o: Overview }) {
  const launch = useLaunch();
  const ui = useUi();
  const portal = !!o.integrations?.portal_enabled && !o.sync?.error;
  const time = timeOnly(o.sync?.last_success);
  return (
    <>
      <SheetSection title="Cases">
        <div className="grid gap-2">
          {(o.issues || []).map((i) => (
            <button
              key={i.id}
              type="button"
              aria-current={i.id === launch.selected ? 'true' : 'false'}
              onClick={() => {
                ui.closeSheet();
                launch.selectCase(i.id);
              }}
              className="flex min-h-11 items-center justify-between gap-2 border-b border-line text-left aria-[current=true]:font-semibold"
            >
              <span>{(i.title || 'Case').split(':')[0]}</span>
              {(i.shortage ?? 0) > 0 ? <Badge tone="risk"><Dot />{num(i.shortage)} short</Badge> : <Badge>Check</Badge>}
            </button>
          ))}
        </div>
      </SheetSection>
      <SheetSection title="Health" testId="health">
        <div className="flex flex-wrap gap-2">
          <Badge tone={o.integrations?.ai_enabled ? 'ok' : 'warn'}><Dot />Agent {o.integrations?.ai_enabled ? 'ready' : 'not set up'}</Badge>
          <Badge tone={portal ? 'ok' : 'warn'}><Dot />Portal {portal ? 'live' : 'offline'}</Badge>
          {time ? <Badge>Checked {time}</Badge> : null}
        </div>
      </SheetSection>
    </>
  );
}

export function DetailsSheet({ d, o, onStartDemo }: { d: Detail; o: Overview; onStartDemo: () => void }) {
  const ui = useUi();
  const launch = useLaunch();
  const running = launch.busy || !!o.agent?.running;
  const signOut = async () => {
    try {
      await api('/api/logout', {});
    } catch {
      /* the redirect below is the safe default */
    }
    window.location.href = '/login';
  };
  const footer = (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" data-testid="run-agent" disabled={running} onClick={() => void launch.runAgent()}>
        <RefreshCw className="size-4" aria-hidden="true" />
        Run agent
      </Button>
      <Button size="sm" variant="secondary" data-testid="sync" disabled={launch.busy} onClick={() => void launch.syncNow()}>Sync</Button>
      <Button size="sm" variant="secondary" data-testid="print" onClick={() => window.print()}>
        <Printer className="size-4" aria-hidden="true" />
        Print
      </Button>
      <Button size="sm" variant="ghost" data-testid="demo-start" onClick={onStartDemo}>
        <Sparkles className="size-4" aria-hidden="true" />
        Start guided demo
      </Button>
      <Button size="sm" variant="ghost" data-testid="sign-out" onClick={() => void signOut()}>
        <LogOut className="size-4" aria-hidden="true" />
        Sign out
      </Button>
    </div>
  );
  return (
    <Sheet open={ui.sheetOpen} onOpenChange={ui.setSheetOpen} title="Details" footer={footer} returnFocusId={ui.openerId}>
      <Tabs value={ui.tab} onValueChange={(v) => ui.setTab(v as TabId)}>
        <TabsList aria-label="Details sections">
          <TabsTrigger value="brief">Brief</TabsTrigger>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="numbers">Numbers</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="offer">Reviewed offer</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>
        <TabsContent value="brief"><BriefTab d={d} /></TabsContent>
        <TabsContent value="agent"><SheetSection title="What the agent did"><AgentRail d={d} o={o} legend /></SheetSection></TabsContent>
        <TabsContent value="numbers"><NumbersTab d={d} o={o} /></TabsContent>
        <TabsContent value="messages"><MessagesTab d={d} o={o} /></TabsContent>
        <TabsContent value="offer"><OfferTab d={d} /></TabsContent>
        <TabsContent value="health"><HealthTab o={o} /></TabsContent>
      </Tabs>
    </Sheet>
  );
}
