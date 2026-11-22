/* Launch tracking logic: pure functions, no network, no clock except what the caller passes in. */
import type { Detail, Overview, PublicEvent } from './types';

export type StageState = 'done' | 'current' | 'upcoming' | 'blocked';
export type StageIcon = 'database' | 'records' | 'problem' | 'agent' | 'approved' | 'sent' | 'reply' | 'offer' | 'truck';
export type StageId = 'data' | 'records' | 'problem' | 'plan' | 'approved' | 'sent' | 'reply' | 'offer' | 'trucks';

export interface Stage {
  id: StageId;
  label: string;
  icon: StageIcon;
  state: StageState;
  sub: string;
  at: string | null;
}

const TZ = 'Europe/Berlin';
const ORDER: [StageId, string, StageIcon][] = [
  ['data', 'Data in', 'database'],
  ['records', 'Records read', 'records'],
  ['problem', 'Problem found', 'problem'],
  ['plan', 'Agent plan', 'agent'],
  ['approved', 'Approved', 'approved'],
  ['sent', 'Sent', 'sent'],
  ['reply', 'Reply', 'reply'],
  ['offer', 'Offer reviewed', 'offer'],
  ['trucks', 'On the trucks', 'truck'],
];
const IDX = Object.fromEntries(ORDER.map(([id], i) => [id, i])) as Record<StageId, number>;

/* ----- time ----- */
const fmtStamp = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/* 'Sat 21:42' in Berlin time, '' when unknown */
export function stamp(v?: string | Date | null): string {
  if (!v) return '';
  const t = v instanceof Date ? v : new Date(v);
  return Number.isNaN(t.getTime()) ? '' : fmtStamp.format(t).replace(/,/g, '');
}

/* the instant at which a Berlin wall clock time happens on a given day (handles CET and CEST) */
export function berlinInstant(day: string, hour = 20, minute = 0): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day || '');
  if (!m) return null;
  const want = Date.UTC(+m[1], +m[2] - 1, +m[3], hour, minute);
  let guess = want;
  for (let i = 0; i < 2; i++) {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date(guess))
      .reduce<Record<string, number>>((a, x) => ({ ...a, [x.type]: +x.value }), {});
    guess += want - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return new Date(guess);
}

export const deadlineAt = (launchIso?: string | null): Date | null => berlinInstant(String(launchIso || ''), 20, 0);
export const deadlineText = (launchIso?: string | null): string => stamp(deadlineAt(launchIso));

const at = (now: Date | number): number => (typeof now === 'number' ? now : now.getTime());

/* '5h 12m left', '42m left', 'Deadline passed', '' when the date is unknown */
export function countdownLabel(now: Date | number, launchIso?: string | null): string {
  const end = deadlineAt(launchIso);
  if (!end) return '';
  const ms = end.getTime() - at(now);
  if (ms <= 0) return 'Deadline passed';
  const mins = Math.max(1, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m left` : `${mins}m left`;
}
export const isPastDeadline = (now: Date | number, launchIso?: string | null): boolean => {
  const end = deadlineAt(launchIso);
  return !!end && end.getTime() <= at(now);
};

/* ----- stage logic ----- */
export type Target = 'decision' | 'agent';
type Step = 'start' | 'plan' | 'approve' | 'escalate' | 'send' | 'sending' | 'unknown_delivery' | 'wait_reply' | 'review_reply' | 'offer';
interface Position {
  level: number; /* index of the current stage */
  blocked: boolean;
  step: Step;
}

const PAST_SEND = ['sending', 'sent', 'delivery_unknown', 'reply_review_required', 'offer_reviewed'];
const hasPlan = (d: Detail): boolean => !!(d.brief || (d.trace && d.trace.length) || d.run_mode || d.case?.draft || d.case?.investigation);

/* supplier inquiry plus the escalation message (when one exists): 'n of 2' */
export function approvalCounts(d: Detail): { done: number; total: number } {
  const c = d.case || {};
  const past = !!c.sent_at || PAST_SEND.includes(c.state || '');
  const esc = d.escalation;
  const total = esc ? 2 : 1;
  const done = (c.approved || past ? 1 : 0) + (esc && (esc.approved || past) ? 1 : 0);
  return { done: Math.min(done, total), total };
}

function position(d: Detail): Position {
  const c = d.case || {};
  const { done, total } = approvalCounts(d);
  const at = (level: number, step: Step, blocked = false): Position => ({ level, step, blocked });
  const awaiting = (): Position => {
    if (!hasPlan(d)) return at(IDX.plan, 'plan');
    return at(IDX.approved, c.approved && done < total ? 'escalate' : 'approve');
  };
  const afterSend = (): Position => {
    if (d.offer) return at(IDX.trucks, 'offer');
    return (d.replies || []).length ? at(IDX.reply, 'review_reply', true) : at(IDX.reply, 'wait_reply');
  };
  /* explicit on case.state; anything else falls back to the evidence */
  switch (c.state) {
    case 'detected':
    case 'drafted':
      return awaiting();
    case 'approved':
      if (!c.approved) return awaiting();
      return done >= total ? at(IDX.sent, 'send') : at(IDX.approved, 'escalate');
    case 'sending':
      return at(IDX.sent, 'sending');
    case 'delivery_unknown':
      return at(IDX.sent, 'unknown_delivery', true);
    case 'sent':
      return afterSend();
    case 'reply_review_required':
      return at(IDX.reply, 'review_reply', true);
    case 'offer_reviewed':
      return at(IDX.trucks, 'offer');
    default:
      break;
  }
  if (d.offer) return at(IDX.trucks, 'offer');
  if (c.sent_at) return afterSend();
  if (!d.case && d.shortage == null && !d.id) return at(IDX.data, 'start');
  return awaiting();
}

export function workflowStages(d: Detail, o: Overview): Stage[] {
  const p = position(d);
  const c = d.case || {};
  const { done, total } = approvalCounts(d);
  const syncAt = o.sync?.last_success || null;
  const issues = (o.issues || []).length;
  const replies = d.replies || [];
  const syncBad = !!o.sync?.error && !syncAt;
  const fmt = (n: number) => new Intl.NumberFormat('en-GB').format(Math.round(n));
  const subs: Record<StageId, string> = {
    data: syncAt ? stamp(syncAt) : syncBad ? 'Sync failed' : '',
    records: issues ? `${issues} issue${issues === 1 ? '' : 's'}` : '',
    problem: d.shortage != null ? (d.shortage > 0 ? `${fmt(d.shortage)} short` : 'No gap') : '',
    plan: d.run_mode === 'rule_based' ? 'Rule-based' : d.run_mode ? 'Agent' : '',
    approved: `${done} of ${total}`,
    sent: p.step === 'sending' ? 'Sending' : p.step === 'unknown_delivery' ? 'Not confirmed' : stamp(c.sent_at),
    reply: p.step === 'review_reply' ? 'Needs review' : replies.length ? `${replies.length} imported` : '',
    offer: d.offer ? 'Reviewed' : '',
    trucks: 'Not confirmed',
  };
  const times: Partial<Record<StageId, string | null>> = {
    data: syncAt,
    sent: c.sent_at || null,
    reply: replies[0]?.received_at || null,
    offer: d.offer?.reviewed_at || null,
  };
  return ORDER.map(([id, label, icon], i) => {
    let state: StageState = i < p.level ? 'done' : i === p.level ? (p.blocked ? 'blocked' : 'current') : 'upcoming';
    if (id === 'trucks') state = 'upcoming'; /* never done from our side */
    if (id === 'data' && p.level === 0 && syncBad) state = 'blocked';
    const future = i > p.level && id !== 'trucks';
    return {
      id,
      label: id === 'sent' && c.sent_at ? (c.sent_manually ? 'Sent by hand' : 'Sent') : label,
      icon,
      state,
      sub: future ? '' : subs[id],
      at: future ? null : times[id] ?? null,
    };
  });
}

/* index of the stage the launch is at (the last stage when everything we can do is done) */
export const currentStage = (d: Detail, _o?: Overview): number => position(d).level;

export function statusHeadline(d: Detail, o: Overview): string {
  const p = position(d);
  const c = d.case || {};
  switch (p.step) {
    case 'start':
      return o.sync?.error ? 'Waiting for portal data' : 'Reading the portal data';
    case 'plan':
      return o.agent?.running ? 'Agent is working on a plan' : 'Waiting for the agent plan';
    case 'approve':
      return 'Waiting for your approval';
    case 'escalate':
      return 'Waiting for the second approval';
    case 'send':
      return c.draft?.manual_send ? 'Approved, waiting to be sent by hand' : 'Approved, waiting to be sent';
    case 'sending':
      return 'Sending now';
    case 'unknown_delivery':
      return 'Delivery not confirmed';
    case 'wait_reply':
      return c.sent_manually ? 'Sent by hand, waiting for reply' : 'Sent, waiting for reply';
    case 'review_reply':
      return 'Reply needs review';
    case 'offer':
      return 'Offer reviewed, supply not confirmed';
  }
}

export interface NextAction {
  text: string;
  button: string;
  target: Target;
}

export function nextAction(d: Detail): NextAction {
  switch (position(d).step) {
    case 'start':
      return { text: 'Wait for the portal to sync', button: 'Open agent', target: 'agent' };
    case 'plan':
      return { text: 'Run the agent to get a plan', button: 'Open agent', target: 'agent' };
    case 'approve':
      return { text: 'Approve the supplier request', button: 'Go to decision', target: 'decision' };
    case 'escalate':
      return { text: 'Approve the escalation message too', button: 'Go to decision', target: 'decision' };
    case 'send':
      return { text: 'Send it from your own mail', button: 'Go to decision', target: 'decision' };
    case 'sending':
      return { text: 'Wait while the mail goes out', button: 'Go to decision', target: 'decision' };
    case 'unknown_delivery':
      return { text: 'Check sent mail before retrying', button: 'Go to decision', target: 'decision' };
    case 'wait_reply':
      return { text: 'Import the supplier reply when it comes', button: 'Go to decision', target: 'decision' };
    case 'review_reply':
      return { text: 'Review the reply, nothing is ordered', button: 'Review reply', target: 'decision' };
    case 'offer':
      return { text: 'Ask the supplier to confirm supply', button: 'Go to decision', target: 'decision' };
  }
}

/* ----- tracking history ----- */
export interface HistoryRow {
  id: string;
  at: string | null;
  time: string;
  text: string;
  tone: 'ok' | 'warn' | 'info' | 'neutral';
}

const words = (s: string, n = 10): string => {
  const w = s.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  return w.length > n ? `${w.slice(0, n).join(' ').replace(/[.,;:]+$/, '')}…` : w.join(' ');
};

/* a name is shown only when the public event text already carries it ('by Ann') */
const nameIn = (msg: string): string | null => /\bby\s+([A-Z][\w'-]*(?:\s[A-Z][\w'-]*)?)/.exec(msg)?.[1] || null;

function humanise(e: PublicEvent): { text: string; tone: HistoryRow['tone'] } {
  const msg = String(e.message || '');
  switch (e.kind) {
    case 'detected':
      return { text: 'Problem found', tone: 'warn' };
    case 'drafted':
      return { text: 'Request drafted', tone: 'info' };
    case 'investigated':
      return { text: 'Agent finished', tone: 'info' };
    case 'approved': {
      const n = nameIn(msg);
      return { text: n ? `Approved by ${n}` : 'Approved', tone: 'ok' };
    }
    case 'escalation_approved': {
      const n = nameIn(msg);
      return { text: n ? `Escalation approved by ${n}` : 'Escalation approved', tone: 'ok' };
    }
    case 'sending':
      return { text: 'Sending', tone: 'info' };
    case 'sent':
      return { text: 'Sent', tone: 'ok' };
    case 'sent_manually':
      return { text: 'Sent by hand', tone: 'ok' };
    case 'delivery_unknown':
      return { text: 'Delivery not confirmed', tone: 'warn' };
    case 'reply_received':
      return { text: 'Reply imported', tone: 'info' };
    case 'offer_reviewed':
      return { text: 'Offer reviewed', tone: 'ok' };
    default:
      return { text: msg ? words(msg) : 'Update', tone: 'neutral' };
  }
}

const time = (v?: string | null): number => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

/* newest first; consecutive agent_tool events collapse into one row */
export function historyRows(events?: PublicEvent[] | null): HistoryRow[] {
  const idx = (events || []).filter((e) => !!e && typeof e === 'object').map((e, i) => ({ e, i }));
  idx.sort((a, b) => {
    const x = time(a.e.at);
    const y = time(b.e.at);
    return Number.isNaN(x) || Number.isNaN(y) || x === y ? a.i - b.i : x - y;
  });
  const rows: HistoryRow[] = [];
  type Run = { count: number; at: string | null; i: number };
  const box: { run: Run | null } = { run: null };
  const flush = () => {
    const r = box.run;
    if (!r) return;
    rows.push({ id: `agent-${r.i}`, at: r.at, time: stamp(r.at), text: `Agent ran ${r.count} step${r.count === 1 ? '' : 's'}`, tone: 'info' });
    box.run = null;
  };
  for (const { e, i } of idx) {
    if (e.kind === 'agent_tool') {
      box.run = box.run ? { ...box.run, count: box.run.count + 1, at: e.at ?? box.run.at } : { count: 1, at: e.at ?? null, i };
      continue;
    }
    flush();
    const h = humanise(e);
    rows.push({ id: `${e.kind || 'event'}-${i}`, at: e.at ?? null, time: stamp(e.at), text: h.text, tone: h.tone });
  }
  flush();
  return rows.reverse();
}
