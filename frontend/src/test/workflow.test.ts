import { describe, expect, it } from 'vitest';
import type { Detail, Overview } from '@/lib/types';
import { approvalCounts, countdownLabel, currentStage, historyRows, nextAction, stamp, statusHeadline, workflowStages } from '@/lib/workflow';

const o: Overview = { launch_date: '2026-11-22', issues: [{ id: 'a' }, { id: 'b' }], sync: { last_success: '2026-11-21T12:00:00Z' } };
const base: Detail = { id: 'a', title: 'Game cards', shortage: 6800, run_mode: 'agent', brief: {} };
const st = (d: Detail) => workflowStages(d, o);
const id = (d: Detail) => st(d)[currentStage(d, o)].id;

describe('stages by case.state', () => {
  it('has nine stages in order', () => {
    expect(st(base).map((s) => s.id)).toEqual(['data', 'records', 'problem', 'plan', 'approved', 'sent', 'reply', 'offer', 'trucks']);
  });
  it('detected without a plan waits at the agent plan', () => {
    const d: Detail = { id: 'a', shortage: 5, case: { state: 'detected' } };
    expect(id(d)).toBe('plan');
    expect(statusHeadline(d, o)).toBe('Waiting for the agent plan');
    expect(nextAction(d).target).toBe('agent');
  });
  it('detected with a plan waits for approval', () => {
    const d: Detail = { ...base, case: { state: 'detected' } };
    expect(id(d)).toBe('approved');
    expect(statusHeadline(d, o)).toBe('Waiting for your approval');
    expect(st(d)[3].state).toBe('done');
  });
  it('drafted waits for approval', () => {
    const d: Detail = { ...base, case: { state: 'drafted', draft: { subject: 's' } } };
    expect(id(d)).toBe('approved');
    expect(st(d)[4].sub).toBe('0 of 1');
  });
  it('approved with both approvals moves to sent', () => {
    const d: Detail = { ...base, case: { state: 'approved', approved: true }, escalation: { approved: true } };
    expect(id(d)).toBe('sent');
    expect(st(d)[4]).toMatchObject({ state: 'done', sub: '2 of 2' });
  });
  it('approved with the escalation open stays at approvals, 1 of 2', () => {
    const d: Detail = { ...base, case: { state: 'approved', approved: true }, escalation: { approved: false } };
    expect(id(d)).toBe('approved');
    expect(st(d)[4].sub).toBe('1 of 2');
    expect(statusHeadline(d, o)).toBe('Waiting for the second approval');
  });
  it('approved flag lost (stale evidence) goes back to approval', () => {
    expect(id({ ...base, case: { state: 'approved', approved: false } })).toBe('approved');
  });
  it('sending is current at sent and not done', () => {
    const d: Detail = { ...base, case: { state: 'sending', approved: false } };
    expect(id(d)).toBe('sent');
    expect(st(d)[5].state).toBe('current');
    expect(statusHeadline(d, o)).toBe('Sending now');
  });
  it('delivery_unknown is blocked at sent', () => {
    const d: Detail = { ...base, case: { state: 'delivery_unknown' } };
    expect(st(d)[5]).toMatchObject({ state: 'blocked', sub: 'Not confirmed' });
    expect(statusHeadline(d, o)).toBe('Delivery not confirmed');
  });
  it('sent by hand', () => {
    const d: Detail = { ...base, case: { state: 'sent', sent_at: '2026-11-21T20:42:00Z', sent_manually: true } };
    expect(id(d)).toBe('reply');
    expect(st(d)[5]).toMatchObject({ label: 'Sent by hand', state: 'done' });
    expect(statusHeadline(d, o)).toBe('Sent by hand, waiting for reply');
  });
  it('sent not by hand', () => {
    const d: Detail = { ...base, case: { state: 'sent', sent_at: '2026-11-21T20:42:00Z' } };
    expect(st(d)[5].label).toBe('Sent');
    expect(statusHeadline(d, o)).toBe('Sent, waiting for reply');
  });
  it('reply_review_required is blocked at reply', () => {
    const d: Detail = { ...base, case: { state: 'reply_review_required', sent_at: 'x' }, replies: [{ id: 'r' }] };
    expect(st(d)[6]).toMatchObject({ state: 'blocked', sub: 'Needs review' });
    expect(statusHeadline(d, o)).toBe('Reply needs review');
  });
  it('offer_reviewed completes the offer stage but never the trucks', () => {
    const d: Detail = { ...base, case: { state: 'offer_reviewed', sent_at: 'x' }, replies: [{ id: 'r' }] };
    const s = st(d);
    expect(s[7].state).toBe('done');
    expect(s[8].state).toBe('upcoming');
    expect(currentStage(d, o)).toBe(8);
    expect(statusHeadline(d, o)).toBe('Offer reviewed, supply not confirmed');
  });
  it('a recovery offer alone counts as reviewed', () => {
    expect(st({ ...base, offer: { quantity: 1 } })[7].state).toBe('done');
  });
  it('trucks are never done', () => {
    for (const state of ['detected', 'sent', 'offer_reviewed', 'weird']) expect(st({ ...base, case: { state } })[8].state).not.toBe('done');
  });
  it('missing case and unknown state fall back safely', () => {
    expect(id({})).toBe('data');
    expect(statusHeadline({}, o)).toBe('Reading the portal data');
    expect(id({ ...base, case: { state: 'zzz' } })).toBe('approved');
    expect(() => st({ case: undefined, replies: undefined, events: undefined })).not.toThrow();
  });
  it('shows the shortage, issue count and sync time', () => {
    const s = st(base);
    expect(s[1].sub).toBe('2 issues');
    expect(s[2].sub).toBe('6,800 short');
    expect(s[0].sub).toMatch(/^\w{3} \d{2}:\d{2}$/);
  });
  it('failed sync blocks the first stage', () => {
    expect(workflowStages({}, { sync: { error: true } })[0].state).toBe('blocked');
  });
});

describe('approvalCounts', () => {
  it('counts supplier and escalation', () => {
    expect(approvalCounts({ case: {} })).toEqual({ done: 0, total: 1 });
    expect(approvalCounts({ case: { approved: true }, escalation: {} })).toEqual({ done: 1, total: 2 });
    expect(approvalCounts({ case: { state: 'sent' }, escalation: {} })).toEqual({ done: 2, total: 2 });
  });
});

describe('countdownLabel', () => {
  it('formats hours and minutes before 20:00 Berlin (19:00Z in November)', () => {
    expect(countdownLabel(Date.parse('2026-11-22T13:48:00Z'), '2026-11-22')).toBe('5h 12m left');
    expect(countdownLabel(Date.parse('2026-11-22T18:18:00Z'), '2026-11-22')).toBe('42m left');
    expect(countdownLabel(new Date('2026-11-21T19:00:00Z'), '2026-11-22')).toBe('24h 0m left');
  });
  it('past the deadline and unknown date', () => {
    expect(countdownLabel(Date.parse('2026-11-22T19:00:00Z'), '2026-11-22')).toBe('Deadline passed');
    expect(countdownLabel(Date.parse('2026-11-23T10:00:00Z'), '2026-11-22')).toBe('Deadline passed');
    expect(countdownLabel(Date.now(), null)).toBe('');
  });
  it('handles summer time', () => {
    expect(countdownLabel(Date.parse('2026-07-01T17:00:00Z'), '2026-07-01')).toBe('1h 0m left');
  });
  it('stamps in Berlin time', () => {
    expect(stamp('2026-11-21T20:42:00Z')).toBe('Sat 21:42');
    expect(stamp('nope')).toBe('');
  });
});

describe('historyRows', () => {
  it('humanises kinds, newest first', () => {
    const rows = historyRows([
      { at: '2026-11-21T10:00:00Z', kind: 'drafted', message: 'Request drafted' },
      { at: '2026-11-21T11:00:00Z', kind: 'approved', message: 'Ann Lee approved this inquiry only. by Ann Lee' },
      { at: '2026-11-21T12:00:00Z', kind: 'offer_reviewed', message: 'Offer reviewed' },
    ]);
    expect(rows.map((r) => r.text)).toEqual(['Offer reviewed', 'Approved by Ann Lee', 'Request drafted']);
    expect(rows[0].time).toBe('Sat 13:00');
  });
  it('names the approver only when the text carries it', () => {
    expect(historyRows([{ kind: 'approved', message: 'Approved' }])[0].text).toBe('Approved');
  });
  it('maps other kinds', () => {
    const t = (kind: string) => historyRows([{ kind, message: 'x' }])[0].text;
    expect(t('detected')).toBe('Problem found');
    expect(t('sent_manually')).toBe('Sent by hand');
    expect(t('reply_received')).toBe('Reply imported');
  });
  it('collapses consecutive agent steps', () => {
    const ev = Array.from({ length: 12 }, (_, i) => ({ at: `2026-11-21T10:${String(i).padStart(2, '0')}:00Z`, kind: 'agent_tool', message: 'Checked a record' }));
    const rows = historyRows([{ at: '2026-11-21T09:00:00Z', kind: 'drafted' }, ...ev, { at: '2026-11-21T11:00:00Z', kind: 'investigated' }]);
    expect(rows.map((r) => r.text)).toEqual(['Agent finished', 'Agent ran 12 steps', 'Request drafted']);
  });
  it('trims unknown messages to 10 words and survives empty input', () => {
    const r = historyRows([{ kind: 'zzz', message: 'one two three four five six seven eight nine ten eleven twelve' }]);
    expect(r[0].text.split(' ').length).toBeLessThanOrEqual(10);
    expect(historyRows(undefined)).toEqual([]);
  });
});
