/* Honesty rules, ported from the legacy UI (app/static_legacy/app.js). Nothing here guesses. */
import type { Approver, Detail, Option, Overview, Product, TraceRow, WhatIfResult } from './types';
import { num, whatIfLabel } from './format';

export const MANUAL_NOTE = 'Send this one yourself from your own mail after approval.';

export const nounOf = (d: Detail): string => {
  const t = d.title || '';
  return /card/i.test(t) ? 'game cards' : /book/i.test(t) ? 'art books' : /statue/i.test(t) ? 'statues' : /magnet/i.test(t) ? 'magnets' : 'parts';
};

export const shortLines = (d: Detail) => (d.allocation?.lines || []).filter((l) => (l.short ?? 0) > 0);
export const recName = (d: Detail): string | null => d.brief?.recommendation || null;

export function recOption(d: Detail): Option | undefined {
  const opts = d.options || [];
  return opts.find((x) => x.recommended === true) || opts.find((x) => x.recommended === undefined && x.title && x.title === recName(d));
}

export const isRecommended = (x: Option, d: Detail): boolean =>
  x.recommended === true || (x.recommended === undefined && !!x.title && x.title === recName(d));

export const SENT_BY_HAND = 'Sent by hand, delivery not confirmed';

export const manualSend = (d: Detail): boolean => !!d.case?.draft?.manual_send;

/* copies gained is shown only when it is real: a recovery/release with a known arrival, never an allocation or a check */
export function gainsKnown(opt?: Option | null): boolean {
  if (!opt || opt.copies_gained == null) return false;
  if (opt.kind === 'allocation' || opt.kind === 'verify' || opt.copies_gained_source === 'arrival_unknown' || opt.copies_gained_source === 'not_applicable') return false;
  return opt.kind ? true : opt.arrival_known === true;
}

export const briefGains = (d: Detail): number | null =>
  d.brief?.copies_gained != null && gainsKnown(recOption(d)) ? d.brief.copies_gained : null;

export const approverName = (d: Detail): string => d.case?.approver || d.brief?.approver?.name || 'your approver';

export const approvalsNeeded = (d: Detail): number => {
  const c = d.case || {};
  return (c.approved ? 0 : 1) + (d.escalation && !d.escalation.approved ? 1 : 0);
};

/* the card shows the first sentence of the recommendation; the sheet has all of it */
export const cardTitle = (t?: string | null): string | null =>
  t ? String(t).replace(/^First action:\s*/i, '').split(/(?<=[a-z0-9)])\.\s+(?=[A-Z])/)[0] : null;

export function potentialText(x: Option, units = 'units'): string | null {
  return x.potential_units != null ? `could release up to ${num(x.potential_units)} ${units}, arrival not confirmed` : null;
}

/* ----- agent grouping (fallback when tool-calling fields are absent) ----- */
export interface AgentGroup {
  agent: string;
  steps: TraceRow[];
  main: TraceRow;
}

export function agentGroups(d: Detail): AgentGroup[] {
  const groups: AgentGroup[] = [];
  for (const t of d.trace || []) {
    const key = t.agent || 'Agent';
    let g = groups.find((x) => x.agent === key);
    if (!g) {
      g = { agent: key, steps: [], main: t };
      groups.push(g);
    }
    g.steps.push(t);
  }
  for (const g of groups) {
    g.main = g.steps.find((s) => s.autonomy === 'approval') || g.steps.find((s) => s.autonomy === 'never') || g.steps[g.steps.length - 1];
  }
  return groups;
}

export const hasToolRows = (d: Detail): boolean => (d.trace || []).some((t) => !!t.tool);

/* ----- decision card state (one primary button that morphs) ----- */
export type CardState =
  | { kind: 'no_gap' }
  | { kind: 'delivery_unknown' }
  | { kind: 'offer' }
  | { kind: 'sent'; manual: boolean }
  | { kind: 'replied' }
  | { kind: 'approved_manual' }
  | { kind: 'approved_send'; sendEnabled: boolean }
  | { kind: 'approved_partial' }
  | { kind: 'run'; label: 'Run agent' | 'Draft the request' | 'Retry' }
  | { kind: 'approve' };

export function cardState(d: Detail, agentError: boolean, aiOn: boolean, emailOn: boolean): CardState {
  const c = d.case || {};
  if (!((d.shortage ?? 0) > 0) && !c.draft && !c.sent_at) return { kind: 'no_gap' };
  if (c.state === 'sending' || c.state === 'delivery_unknown') return { kind: 'delivery_unknown' };
  if (d.offer) return { kind: 'offer' };
  if (c.sent_at) return (d.replies || []).length ? { kind: 'replied' } : { kind: 'sent', manual: !!c.sent_manually };
  if (c.draft && c.approved) {
    if (d.escalation && !d.escalation.approved) return { kind: 'approved_partial' };
    return manualSend(d) ? { kind: 'approved_manual' } : { kind: 'approved_send', sendEnabled: emailOn };
  }
  if (!d.brief) {
    const run = aiOn && !c.investigation;
    return { kind: 'run', label: agentError ? 'Retry' : run ? 'Run agent' : 'Draft the request' };
  }
  return { kind: 'approve' };
}

/* ----- what-if ----- */
export function whatIfDefault(d: Detail): number {
  const t = Date.parse(`${d.shipments?.[0]?.balance_eta || ''}T12:00:00`);
  if (!Number.isFinite(t)) return 24;
  return Math.max(0, Math.min(72, Math.round((t - Date.now()) / 3.6e6)));
}

export function whatIfProduct(d: Detail, o: Overview, res?: WhatIfResult | null): Product | null {
  const prods = o.products || [];
  const line = shortLines(d)[0];
  if (line) return prods.find((p) => p.id === line.product_id) || null;
  if (res) return prods.find((p) => p.remaining === (res.copies_ship || 0) + (res.copies_short || 0)) || null;
  return null;
}

export function whatIfSentence(d: Detail, o: Overview, hours: number, res: WhatIfResult | null, error: boolean): string {
  if (error) return "Can't work this out right now.";
  if (!res) return 'Working it out.';
  const p = whatIfProduct(d, o, res);
  return `If ${nounOf(d)} arrive ${res.label || whatIfLabel(hours)}, ${num(res.copies_ship ?? 0)}${p?.name ? ` ${p.name}` : ''} copies ship.`;
}

export const approverLabel = (a?: Approver | null): string =>
  !a || !a.role ? 'unknown' : a.vacancy ? `${a.role}, seat vacant` : a.provisional ? `${a.name || a.role}, provisional` : a.name || a.role;

/* the plain sentence under the title: what is left of the recommendation after its first sentence */
export function cardLead(t?: string | null): string | null {
  if (!t) return null;
  const parts = String(t).replace(/^First action:\s*/i, '').split(/(?<=[a-z0-9)])\.\s+(?=[A-Z])/);
  return parts.length > 1 ? parts[1].replace(/\.$/, '') + '.' : null;
}
