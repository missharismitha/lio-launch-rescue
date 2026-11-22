import { describe, expect, it } from 'vitest';
import { autoStartKey, modeBadge, shouldAutoStart, stepMeta, STEP_META, autonomyWord, callsText, blockedText, phaseOf, groupPhases, nowText } from '@/lib/agentSteps';
import type { Detail, Overview } from '@/lib/types';

/* app/labels.py GENERIC, AGENT_PHASES, TOOL_LABELS values, NEVER_LABELS values, RULE_LABELS values */
const FIXED = [
  'Read a supplier notice', 'Checked a supplier contract', 'Checked the approval policy', 'Checked stock records', 'Checked the packing plan',
  'Read a source document', 'Searched the records', 'Reviewed the stock numbers', 'Checked a record',
  'Checking for new data', 'Reading the records', 'Weighing the options', 'Drafting the request', 'Ready for your review',
  'Read the case', 'Read a record', 'Looked for supplier holds', 'Looked for conflicting records', 'Priced an option', 'Compared transport modes',
  'Ran a what-if on arrival time', 'Proposed a recovery option', 'Drafted a supplier message', 'Drafted an escalation', 'Set the recommendation',
  'Flagged an open question', 'Queued for approval',
  'Send email', 'Place an order', 'Book freight', 'Pay', 'Approve', 'Change stock records', 'Unknown tool request',
  'Rule-based fallback', 'Rule-based options', 'Rule-based supplier draft', 'Rule-based escalation draft', 'Rule-based hold check',
];

describe('stepMeta', () => {
  it.each(FIXED)('maps %s to a short label and an icon', (label) => {
    expect(STEP_META[label]).toBeDefined();
    const m = stepMeta(label);
    expect(m.short.split(' ').length).toBeLessThanOrEqual(3);
    expect(m.Icon).toBeTruthy();
  });
  it('falls back safely for unknown, empty and null labels', () => {
    expect(stepMeta('Something the model invented entirely').short).toBe('Something the model');
    expect(stepMeta('').short).toBe('Step');
    expect(stepMeta(null).Icon).toBeTruthy();
  });
  it('autonomy and counters wording', () => {
    expect(autonomyWord('approval')).toBe('Needs approval');
    expect(autonomyWord('weird')).toBeNull();
    expect(callsText(13)).toBe('13 calls');
    expect(callsText(1)).toBe('1 call');
    expect(blockedText(2)).toBe('2 blocked');
  });
  it('honest mode labels', () => {
    expect(modeBadge('agent')?.text).toBe('Model chose the tools');
    expect(modeBadge('agent_partial')?.text).toBe('Model + rules');
    expect(modeBadge('rule_based')?.text).toBe('Rules only');
    expect(modeBadge(null)).toBeNull();
  });
});

const CREW = ['Reconciler', 'Investigator', 'Allocation Planner', 'Pricer', 'Policy Officer', 'Approver-Router', 'Drafter', 'Checker'];
const EXPECT: Record<string, string> = {
  'Read the case': 'read', 'Read a record': 'read', Reconciler: 'read', 'Looked for supplier holds': 'find', 'Looked for conflicting records': 'find',
  'Compared transport modes': 'compare', 'Priced an option': 'compare', 'Checked the approval policy': 'rules', 'Approver-Router': 'rules',
  'Policy Officer': 'rules', 'Drafted a supplier message': 'draft', 'Drafted an escalation': 'draft', 'Drafting the request': 'draft', Checker: 'draft',
  'Set the recommendation': 'decide', 'Queued for approval': 'decide', 'Flagged an open question': 'decide', 'Send email': 'rules',
};

describe('phaseOf', () => {
  it.each([...FIXED, ...CREW])('maps %s to a phase', (label) => {
    expect(['read', 'find', 'compare', 'rules', 'draft', 'decide']).toContain(phaseOf(label));
  });
  it.each(Object.entries(EXPECT))('%s -> %s', (label, phase) => {
    expect(phaseOf(label)).toBe(phase);
  });
  it('unknown, empty and null go to read', () => {
    expect(phaseOf('Something invented')).toBe('read');
    expect(phaseOf('')).toBe('read');
    expect(phaseOf(null)).toBe('read');
    expect(phaseOf(undefined)).toBe('read');
  });
});

describe('groupPhases', () => {
  const row = (raw: string, state: 'running' | 'done' | 'approval' | 'rejected' | 'skipped' = 'done', n = 1) => ({ raw, state, n });
  it('always returns six phases, empty ones waiting', () => {
    const p = groupPhases([]);
    expect(p.map((x) => x.key)).toEqual(['read', 'find', 'compare', 'rules', 'draft', 'decide']);
    expect(p.every((x) => x.state === 'waiting' && x.count === 0)).toBe(true);
    expect(groupPhases(null)).toHaveLength(6);
  });
  it('running, done, count and dedupe as x2', () => {
    const p = groupPhases([row('Read the case'), row('Priced an option'), row('Priced an option', 'running')]);
    expect(p[0].state).toBe('done');
    expect(p[2].state).toBe('running');
    expect(p[2].count).toBe(2);
    const q = groupPhases([row('Priced an option'), row('Priced an option', 'done')]);
    expect(q[2].steps).toHaveLength(1);
    expect(q[2].steps[0].n).toBe(2);
    expect(groupPhases([row('Priced an option', 'done', 3)])[2].count).toBe(3);
  });
  it('approval hand only when the decide phase queued one', () => {
    expect(groupPhases([row('Queued for approval', 'approval')])[5].state).toBe('approval');
    expect(groupPhases([row('Approver-Router', 'approval')])[3].state).toBe('done');
  });
  it('a rejected step is a guard rail in its phase', () => {
    const p = groupPhases([row('Send email', 'rejected'), row('Read the case')]);
    expect(p[3].state).toBe('guard');
    expect(p[0].state).toBe('done');
  });
  it('unknown labels land in read safely', () => {
    const p = groupPhases([row('???')]);
    expect(p[0].count).toBe(1);
    expect(p[0].steps[0].short).toBe('???');
  });
  it('nowText is short and in the present tense', () => {
    expect(nowText('Compared transport modes')).toBe('Comparing transport modes');
    expect(nowText('Ran a what-if on arrival time')).toBe('Running a what-if on arrival time');
    expect(nowText('')).toBe('Working');
    expect(nowText('a b c d e f g h').split(' ')).toHaveLength(6);
  });
});

describe('shouldAutoStart', () => {
  const d: Detail = { id: 'game-card-shortage', shortage: 6800, trace: [] };
  const o: Overview = { agent: { running: false }, integrations: { ai_enabled: true } };
  it('starts when there is no result, once', () => {
    expect(shouldAutoStart(d, o, new Set())).toBe(true);
    expect(shouldAutoStart(d, o)).toBe(true);
    expect(shouldAutoStart(d, o, new Set([autoStartKey(d)]))).toBe(false);
    expect(shouldAutoStart(d, o, [autoStartKey(d)])).toBe(false);
  });
  it('a different case or changed evidence is a new key', () => {
    const other = { ...d, id: 'other' };
    expect(shouldAutoStart(other, o, new Set([autoStartKey(d)]))).toBe(true);
    expect(shouldAutoStart({ ...d, shortage: 100 }, o, new Set([autoStartKey(d)]))).toBe(true);
  });
  it('never while running', () => {
    expect(shouldAutoStart(d, { agent: { running: true } }, [])).toBe(false);
    expect(shouldAutoStart({ ...d, agent: { running: true } }, o, [])).toBe(false);
  });
  it('never when a run result exists', () => {
    expect(shouldAutoStart({ ...d, run_mode: 'agent' }, o, [])).toBe(false);
    expect(shouldAutoStart({ ...d, run_mode: 'rule_based' }, o, [])).toBe(false);
    expect(shouldAutoStart({ ...d, brief: { headline: 'x' } }, o, [])).toBe(false);
  });
  it('never after an error (no auto retry)', () => {
    expect(shouldAutoStart(d, { agent: { error: 'boom' } }, [])).toBe(false);
  });
  it('never without a case or overview, or when there is no gap', () => {
    expect(shouldAutoStart(null, o, [])).toBe(false);
    expect(shouldAutoStart(d, null, [])).toBe(false);
    expect(shouldAutoStart({ id: 'x' }, o, [])).toBe(true);
    expect(shouldAutoStart({ ...d, shortage: 0 }, o, [])).toBe(false);
    expect(shouldAutoStart({ shortage: 5 }, o, [])).toBe(false);
  });
});
