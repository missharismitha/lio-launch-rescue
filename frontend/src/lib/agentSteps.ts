/* Live agent: fixed-vocabulary step metadata (icon, 1-3 word label, autonomy) and the auto-start decision.
   Labels mirror app/labels.py (GENERIC, AGENT_PHASES, TOOL_LABELS, NEVER_LABELS, RULE_LABELS). Nothing here reads free text. */
import {
  Ban, BookOpen, Calculator, CheckCheck, ClipboardList, CircleHelp, FileText, GitCompare, Hand, Hourglass, Lightbulb, ListChecks,
  Lock, Mail, Megaphone, PenLine, RefreshCw, Scale, Search, ShieldCheck, Star, Truck, Wrench, type LucideIcon,
} from 'lucide-react';
import type { Autonomy, Detail, Overview } from './types';

export interface StepMeta {
  short: string;
  Icon: LucideIcon;
  autonomy: Autonomy;
}

const M = (short: string, Icon: LucideIcon, autonomy: Autonomy = 'auto'): StepMeta => ({ short, Icon, autonomy });

export const STEP_META: Record<string, StepMeta> = {
  // GENERIC (streamed while running)
  'Read a supplier notice': M('Supplier notice', FileText),
  'Checked a supplier contract': M('Contract', FileText),
  'Checked the approval policy': M('Policy', ShieldCheck),
  'Checked stock records': M('Stock', ClipboardList),
  'Checked the packing plan': M('Packing plan', ClipboardList),
  'Read a source document': M('Document', FileText),
  'Searched the records': M('Searching', Search),
  'Reviewed the stock numbers': M('Stock numbers', Calculator),
  'Checked a record': M('Record', FileText),
  // AGENT_PHASES
  'Checking for new data': M('New data', RefreshCw),
  'Reading the records': M('Reading', BookOpen),
  'Weighing the options': M('Weighing', Scale),
  'Drafting the request': M('Drafting', PenLine, 'draft'),
  'Ready for your review': M('Ready', CheckCheck),
  // TOOL_LABELS
  'Read the case': M('Case', ClipboardList),
  'Read a record': M('Record', FileText),
  'Looked for supplier holds': M('Holds', Lock),
  'Looked for conflicting records': M('Conflicts', GitCompare),
  'Priced an option': M('Pricing', Calculator),
  'Compared transport modes': M('Transport', Truck),
  'Ran a what-if on arrival time': M('What-if', Hourglass),
  'Proposed a recovery option': M('Option', Lightbulb, 'draft'),
  'Drafted a supplier message': M('Supplier draft', Mail, 'draft'),
  'Drafted an escalation': M('Escalation draft', Megaphone, 'draft'),
  'Set the recommendation': M('Recommendation', Star, 'draft'),
  'Flagged an open question': M('Open question', CircleHelp, 'draft'),
  'Queued for approval': M('Approval', Hand, 'approval'),
  // NEVER_LABELS
  'Send email': M('Send email', Ban, 'never'),
  'Place an order': M('Order', Ban, 'never'),
  'Book freight': M('Freight', Ban, 'never'),
  Pay: M('Pay', Ban, 'never'),
  Approve: M('Approve', Ban, 'never'),
  'Change stock records': M('Stock change', Ban, 'never'),
  'Unknown tool request': M('Unknown tool', Wrench, 'never'),
  // RULE_LABELS
  'Rule-based fallback': M('Rules', ListChecks),
  'Rule-based options': M('Rule options', ListChecks),
  'Rule-based supplier draft': M('Rule draft', ListChecks, 'draft'),
  'Rule-based escalation draft': M('Rule escalation', ListChecks, 'draft'),
  'Rule-based hold check': M('Rule holds', ListChecks),
  // TRACE_AGENTS (crew fallback rows use the agent name as the label)
  Reconciler: M('Reconcile', Calculator),
  Investigator: M('Investigate', Search),
  'Allocation Planner': M('Allocation', Scale),
  Pricer: M('Pricing', Calculator),
  'Policy Officer': M('Policy', ShieldCheck),
  'Approver-Router': M('Routing', Hand, 'approval'),
  Drafter: M('Drafting', PenLine, 'draft'),
  Checker: M('Checking', CheckCheck),
};

const FALLBACK = M('Step', Wrench);

/* Unknown labels never crash and never leak long text: fall back to a generic meta, with the first three words of the label. */
export function stepMeta(label?: string | null): StepMeta {
  const key = String(label ?? '').trim();
  const hit = STEP_META[key];
  if (hit) return hit;
  const short = key.split(/\s+/).slice(0, 3).join(' ').slice(0, 24);
  return { ...FALLBACK, short: short || FALLBACK.short };
}

export const AUTONOMY_CHIP: Record<string, string> = { auto: 'Auto', draft: 'Draft', approval: 'Needs approval', never: 'Never done' };
export const autonomyWord = (a?: Autonomy | null): string | null => (a && AUTONOMY_CHIP[a]) || null;

export function modeBadge(runMode?: string | null): { text: string; short: 'Model' | 'Rules' } | null {
  if (runMode === 'agent') return { text: 'Model chose the tools', short: 'Model' };
  if (runMode === 'agent_partial') return { text: 'Model + rules', short: 'Model' };
  if (runMode === 'rule_based') return { text: 'Rules only', short: 'Rules' };
  return null;
}

/* "13 calls" / "2 blocked": blocked requests are a feature (guard rails). */
export const callsText = (n: number): string => `${n} ${n === 1 ? 'call' : 'calls'}`;
export const blockedText = (n: number): string => `${n} blocked`;

/* elapsed seconds from a streamed step timestamp, or null */
export function offsetSeconds(at?: string | null, first?: string | null): number | null {
  const a = Date.parse(at || '');
  const b = Date.parse(first || '');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((a - b) / 1000));
}

/* ----- phases: the fixed step vocabulary folded into six pipeline stages ----- */
export type StepState = 'running' | 'done' | 'approval' | 'rejected' | 'skipped';
export type PhaseKey = 'read' | 'find' | 'compare' | 'rules' | 'draft' | 'decide';
export type PhaseState = 'waiting' | 'running' | 'done' | 'approval' | 'guard';

export const PHASES: { key: PhaseKey; name: string; Icon: LucideIcon }[] = [
  { key: 'read', name: 'Read', Icon: BookOpen },
  { key: 'find', name: 'Find', Icon: Search },
  { key: 'compare', name: 'Compare', Icon: Scale },
  { key: 'rules', name: 'Rules', Icon: ShieldCheck },
  { key: 'draft', name: 'Draft', Icon: PenLine },
  { key: 'decide', name: 'Decide', Icon: Star },
];

const PHASE_LABELS: Record<PhaseKey, string[]> = {
  read: [
    'Read a supplier notice', 'Checked a supplier contract', 'Checked stock records', 'Checked the packing plan', 'Read a source document',
    'Searched the records', 'Reviewed the stock numbers', 'Checked a record', 'Checking for new data', 'Reading the records',
    'Read the case', 'Read a record', 'Rule-based fallback', 'Reconciler',
  ],
  find: ['Looked for supplier holds', 'Looked for conflicting records', 'Rule-based hold check', 'Investigator'],
  compare: [
    'Compared transport modes', 'Priced an option', 'Ran a what-if on arrival time', 'Proposed a recovery option', 'Weighing the options',
    'Rule-based options', 'Allocation Planner', 'Pricer',
  ],
  rules: [
    'Checked the approval policy', 'Policy Officer', 'Approver-Router', 'Send email', 'Place an order', 'Book freight', 'Pay', 'Approve',
    'Change stock records', 'Unknown tool request',
  ],
  draft: [
    'Drafted a supplier message', 'Drafted an escalation', 'Drafting the request', 'Rule-based supplier draft', 'Rule-based escalation draft',
    'Drafter', 'Checker',
  ],
  decide: ['Set the recommendation', 'Flagged an open question', 'Queued for approval', 'Ready for your review'],
};

const PHASE_OF: Record<string, PhaseKey> = {};
for (const k of Object.keys(PHASE_LABELS) as PhaseKey[]) for (const l of PHASE_LABELS[k]) PHASE_OF[l] = k;

/* Pure: unknown, empty or null labels go to Read, never throw. */
export function phaseOf(label?: string | null): PhaseKey {
  return PHASE_OF[String(label ?? '').trim()] ?? 'read';
}

export interface PhaseInput {
  raw: string;
  state: StepState;
  summary?: string;
  autonomy?: Autonomy | null;
  n?: number;
}
export interface PhaseStep {
  key: string;
  raw: string;
  short: string;
  Icon: LucideIcon;
  state: StepState;
  summary: string;
  autonomy: Autonomy | null;
  n: number;
}
export interface Phase {
  key: PhaseKey;
  name: string;
  Icon: LucideIcon;
  count: number;
  state: PhaseState;
  steps: PhaseStep[];
}

/* Pure: rows in arrival order -> the six phases (always all six). A repeated label in one phase and state becomes one step with n. */
export function groupPhases(rows: readonly PhaseInput[] | null | undefined): Phase[] {
  const phases: Phase[] = PHASES.map((p) => ({ ...p, count: 0, state: 'waiting' as PhaseState, steps: [] }));
  for (const r of rows || []) {
    const phase = phases[PHASES.findIndex((p) => p.key === phaseOf(r.raw))];
    const n = Math.max(1, r.n ?? 1);
    phase.count += n;
    const hit = phase.steps.find((s) => s.raw === r.raw && s.state === r.state);
    if (hit) {
      hit.n += n;
      if (r.summary && !hit.summary.split('; ').includes(r.summary)) hit.summary = hit.summary ? `${hit.summary}; ${r.summary}` : r.summary;
      continue;
    }
    const meta = stepMeta(r.raw);
    phase.steps.push({
      key: `${phase.key}-${phase.steps.length}`, raw: r.raw, short: meta.short, Icon: meta.Icon, state: r.state,
      summary: r.summary || '', autonomy: r.autonomy || meta.autonomy, n,
    });
  }
  for (const p of phases) {
    if (!p.steps.length) continue;
    const has = (s: StepState) => p.steps.some((x) => x.state === s);
    p.state = has('running') ? 'running' : has('rejected') ? 'guard' : p.key === 'decide' && has('approval') ? 'approval' : 'done';
  }
  return phases;
}

/* index of the furthest phase that has steps, -1 when none: drives the progress line */
export const reachedPhase = (phases: Phase[]): number => phases.reduce((m, p, i) => (p.steps.length ? i : m), -1);

const ING: Record<string, string> = {
  Read: 'Reading', Checked: 'Checking', Looked: 'Looking', Priced: 'Pricing', Compared: 'Comparing', Ran: 'Running', Proposed: 'Proposing',
  Drafted: 'Drafting', Set: 'Setting', Flagged: 'Flagging', Queued: 'Queueing', Searched: 'Searching', Reviewed: 'Reviewing',
};
/* "Compared transport modes" -> "Comparing transport modes"; at most six words. */
export function nowText(label?: string | null): string {
  const words = String(label ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'Working';
  if (ING[words[0]]) words[0] = ING[words[0]];
  return words.slice(0, 6).join(' ');
}

/* ----- auto-start ----- */
export const AUTO_START_MS = 1000;

/* Evidence fingerprint: a new shortage picture is a new key, so a changed case may auto-run once more. */
export function autoStartKey(d: Detail): string {
  return [d.id ?? '', d.shortage ?? '', d.required ?? '', d.usable_stock ?? '', d.incoming ?? ''].join('|');
}

export type StartedKeys = ReadonlySet<string> | readonly string[] | null | undefined;
const has = (s: StartedKeys, k: string): boolean => (!s ? false : Array.isArray(s) ? s.includes(k) : (s as ReadonlySet<string>).has(k));

/* Pure: should the live agent start itself now? Never while running, after an error, once a result exists, or twice for one key. */
export function shouldAutoStart(d: Detail | null | undefined, o: Overview | null | undefined, started?: StartedKeys): boolean {
  if (!d || !d.id || !o) return false;
  if (o.agent?.running || d.agent?.running) return false;
  if (o.agent?.error) return false;
  if (d.run_mode) return false;
  if ((d.shortage ?? 1) <= 0) return false;
  if (d.brief || d.case?.draft || d.case?.sent_at || d.offer) return false;
  return !has(started, autoStartKey(d));
}
