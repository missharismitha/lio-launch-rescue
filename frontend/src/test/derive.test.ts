import { describe, expect, it } from 'vitest';
import { approvalsNeeded, cardState, gainsKnown, potentialText, recOption, whatIfSentence } from '@/lib/derive';
import type { Detail, Option, Overview } from '@/lib/types';

describe('gainsKnown (honesty rule)', () => {
  it('is false when copies_gained is null', () => {
    expect(gainsKnown({ kind: 'recovery', copies_gained: null })).toBe(false);
    expect(gainsKnown({ kind: 'recovery' })).toBe(false);
    expect(gainsKnown(undefined)).toBe(false);
  });
  it('is false for allocation, verify and unknown arrival', () => {
    expect(gainsKnown({ kind: 'allocation', copies_gained: 100 })).toBe(false);
    expect(gainsKnown({ kind: 'verify', copies_gained: 100 })).toBe(false);
    expect(gainsKnown({ kind: 'release', copies_gained: 6800, copies_gained_source: 'arrival_unknown' })).toBe(false);
  });
  it('is true for a recovery with a known number', () => {
    expect(gainsKnown({ kind: 'recovery', copies_gained: 6800 })).toBe(true);
  });
  it('without a kind it needs a known arrival', () => {
    expect(gainsKnown({ copies_gained: 5, arrival_known: false })).toBe(false);
    expect(gainsKnown({ copies_gained: 5, arrival_known: true })).toBe(true);
  });
});

describe('potential units wording', () => {
  it('never claims an arrival', () => {
    const x: Option = { potential_units: 36000 };
    expect(potentialText(x)).toBe('could release up to 36,000 units, arrival not confirmed');
    expect(potentialText({})).toBeNull();
  });
});

describe('recommended badge', () => {
  it('only an explicit recommended flag marks an option', () => {
    const d: Detail = { brief: { recommendation: 'A' }, options: [{ title: 'A', recommended: false }, { title: 'B', recommended: true }] };
    expect(recOption(d)?.title).toBe('B');
    expect(recOption({ options: [{ title: 'A', recommended: false }], brief: { recommendation: 'A' } })).toBeUndefined();
  });
});

describe('approvalsNeeded', () => {
  it('counts the supplier draft and the separate escalation', () => {
    expect(approvalsNeeded({ case: { approved: false }, escalation: { approved: false } })).toBe(2);
    expect(approvalsNeeded({ case: { approved: true }, escalation: { approved: false } })).toBe(1);
    expect(approvalsNeeded({ case: { approved: true }, escalation: { approved: true } })).toBe(0);
  });
});

describe('cardState maps the case to exactly one primary action', () => {
  const base: Detail = { shortage: 100, case: {}, brief: { headline: 'x' } };
  it('no brief: run agent / draft / retry', () => {
    expect(cardState({ shortage: 5, case: {} }, false, true, false)).toEqual({ kind: 'run', label: 'Run agent' });
    expect(cardState({ shortage: 5, case: {} }, false, false, false)).toEqual({ kind: 'run', label: 'Draft the request' });
    expect(cardState({ shortage: 5, case: {} }, true, true, false)).toEqual({ kind: 'run', label: 'Retry' });
  });
  it('brief: approve', () => expect(cardState(base, false, true, false)).toEqual({ kind: 'approve' }));
  it('delivery_unknown and sending have no button state', () => {
    expect(cardState({ ...base, case: { state: 'delivery_unknown' } }, false, true, true).kind).toBe('delivery_unknown');
    expect(cardState({ ...base, case: { state: 'sending' } }, false, true, true).kind).toBe('delivery_unknown');
  });
  it('approved: escalation step, manual send, send', () => {
    const ok = { approved: true, draft: { subject: 's' } };
    expect(cardState({ ...base, case: ok, escalation: { approved: false } }, false, true, true).kind).toBe('approved_partial');
    expect(cardState({ ...base, case: { approved: true, draft: { manual_send: true } } }, false, true, true).kind).toBe('approved_manual');
    expect(cardState({ ...base, case: ok }, false, true, false)).toEqual({ kind: 'approved_send', sendEnabled: false });
  });
  it('sent, replied, offer, no gap', () => {
    expect(cardState({ ...base, case: { sent_at: 'x' } }, false, true, true).kind).toBe('sent');
    expect(cardState({ ...base, case: { sent_at: 'x' }, replies: [{ id: '1' }] }, false, true, true).kind).toBe('replied');
    expect(cardState({ ...base, offer: { quantity: 1 } }, false, true, true).kind).toBe('offer');
    expect(cardState({ shortage: 0, case: {} }, false, true, true).kind).toBe('no_gap');
  });
});

describe('what-if sentence', () => {
  const o: Overview = { products: [{ id: 'P', name: 'Standard', remaining: 10 }] };
  const d: Detail = { title: 'Game cards: x', shortage: 4, allocation: { lines: [{ product_id: 'P', name: 'Standard', short: 4 }] } };
  it('states the honest error and the working state', () => {
    expect(whatIfSentence(d, o, 5, null, true)).toBe("Can't work this out right now.");
    expect(whatIfSentence(d, o, 5, null, false)).toBe('Working it out.');
  });
  it('uses the server label and edition name', () => {
    expect(whatIfSentence(d, o, 5, { copies_ship: 1234, copies_short: 0, label: 'in 5 h' }, false)).toBe('If game cards arrive in 5 h, 1,234 Standard copies ship.');
  });
});
