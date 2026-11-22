import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { runModeLine } from '@/components/AgentRail';
import { useUi, type TabId } from '@/hooks/useUi';
import { hasToolRows, shortLines } from '@/lib/derive';
import { num } from '@/lib/format';
import type { Detail, Overview } from '@/lib/types';

/* Guided demo: 2 minutes, real data only. It never approves or sends anything on your behalf.
   A step whose data is absent says so and invents nothing. */
interface Step {
  selector: string;
  sheetTab?: TabId;
  text: string;
  missing?: string;
}

function buildSteps(d: Detail, o: Overview): Step[] {
  const lines = shortLines(d);
  const total = lines.reduce((s, l) => s + (l.short || 0), 0);
  const left = o.pack_status?.hours_left;
  const hold = (d.holds || []).find((x) => x.supplier || x.quantity != null);
  const opts = d.options || [];
  const unknowns = opts.filter((x) => x.price_eur == null).length;
  return [
    {
      selector: '[data-demo="problem"]',
      text: total ? `${num(total)} copies are short${typeof left === 'number' ? `, with about ${Math.round(left)} packing hours left` : ''}. This is the problem.` : 'No shortage is recorded for this case.',
      missing: total ? undefined : 'a packing shortfall',
    },
    {
      selector: '[data-demo="packing"]',
      text: 'The strip shows packed, will ship and short. Drag the slider to see what still ships if the parts arrive at another hour.',
      missing: (d.shortage ?? 0) > 0 ? undefined : 'a packing shortfall',
    },
    {
      selector: '[data-demo="agent"]',
      sheetTab: 'agent',
      text: `${runModeLine(d) || 'These are the steps the agent took.'}. Each tool call shows whether it ran by itself, drafted, or needs approval.`,
      missing: (d.trace || []).length ? undefined : 'an agent run',
    },
    {
      selector: '[data-demo="hold"]',
      sheetTab: 'brief',
      text: hold ? `${hold.supplier || 'A supplier'} is holding ${hold.quantity != null ? `${num(hold.quantity)} units` : 'units'}. ${hold.required_action || ''}`.trim() : '',
      missing: hold ? undefined : 'a supplier hold',
    },
    {
      selector: '[data-demo="options"], [data-demo="options-sheet"]',
      sheetTab: 'brief',
      text: `${opts.length} options. ${unknowns ? `${unknowns} have no known price, so they say unknown instead of a guess.` : 'Every price shown comes from the records.'}`,
      missing: opts.length ? undefined : 'priced options',
    },
    {
      selector: '[data-testid="draft-escalation"]',
      sheetTab: 'messages',
      text: `The escalation draft goes to ${d.escalation?.to_role || 'the approver'}. Approval is two steps and needs a typed name. The app never sends it for you.`,
      missing: d.escalation ? undefined : 'an escalation draft',
    },
    {
      selector: '[data-demo="offer"], [data-testid="offer-details"]',
      sheetTab: 'offer',
      text: d.offer ? `A reviewed offer: ${num(d.offer.quantity)} units arrive ${d.offer.arrival_label || 'at a time to be confirmed'}.${d.offer.simulated ? ' This reply is simulated.' : ''} Nothing is ordered.` : '',
      missing: d.offer ? undefined : 'a reviewed offer',
    },
  ];
}

const visible = (sel: string): HTMLElement | null => {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
};

const TOTAL = 120;

export function DemoOverlay({ d, o }: { d: Detail; o: Overview }) {
  const ui = useUi();
  const [i, setI] = useState(0);
  const [left, setLeft] = useState(TOTAL);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const steps = useMemo(() => buildSteps(d, o), [d, o]);
  const step = steps[i];
  const open = ui.demoOpen;
  const { openSheet, closeSheet, setDemoOpen } = ui;

  const stop = useCallback(() => {
    setDemoOpen(false);
    closeSheet();
  }, [setDemoOpen, closeSheet]);

  useEffect(() => {
    if (!open) return;
    setI(0);
    setLeft(TOTAL);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearInterval(t);
  }, [open]);

  /* open the sheet only when the target is not on the page (e.g. the rail on a phone) */
  useEffect(() => {
    if (!open || !step) return;
    if (step.missing) {
      closeSheet();
      return;
    }
    if (step.selector.includes('draft-escalation')) openSheet('messages', 'details');
    else if (!visible(step.selector) && step.sheetTab) openSheet(step.sheetTab, 'details');
    else closeSheet();
  }, [open, i, step, openSheet, closeSheet]);

  useEffect(() => {
    if (!open || !step) return;
    let first = true;
    const measure = () => {
      const el = step.missing ? null : visible(step.selector);
      if (el && first) {
        first = false;
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const t = window.setInterval(measure, 300);
    const first0 = window.setTimeout(measure, 120);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(first0);
      window.removeEventListener('resize', measure);
    };
  }, [open, i, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        stop();
      } else if (e.key === 'ArrowRight') setI((v) => Math.min(steps.length - 1, v + 1));
      else if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, steps.length, stop]);

  if (!open || !step) return null;
  const done = left === 0;
  const pad = 6;
  return (
    <div data-demo-ui="" className="print:hidden">
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[70] rounded-card ring-2 ring-white transition-[top,left,width,height] duration-200"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: '0 0 0 9999px rgba(11,31,92,.6)' }}
        />
      ) : null}
      <div
        role="dialog"
        aria-label="Guided demo"
        data-testid="demo-card"
        style={{ pointerEvents: 'auto' }}
        className="fixed inset-x-3 bottom-3 z-[71] mx-auto grid max-w-md gap-3 rounded-card border border-line bg-white p-4 shadow-sheet sm:right-6 sm:left-auto sm:mx-0"
      >
        <div className="flex items-center justify-between text-[14px] text-ink-2">
          <span>
            Step {i + 1} of {steps.length}
          </span>
          <span className="num" data-testid="demo-clock">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL} aria-valuenow={TOTAL - left} aria-label="Tour time used">
          <div className="h-full bg-brand" style={{ width: `${((TOTAL - left) / TOTAL) * 100}%` }} />
        </div>
        <p className="m-0" aria-live="polite">
          {done ? 'Time. That was the 2-minute tour.' : step.missing ? `Not in this data yet: ${step.missing}.` : step.text}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={i === 0} onClick={() => setI((v) => Math.max(0, v - 1))}>
            Back
          </Button>
          <Button size="sm" disabled={i >= steps.length - 1} data-testid="demo-next" onClick={() => setI((v) => Math.min(steps.length - 1, v + 1))}>
            Next
          </Button>
          <Button size="sm" variant="ghost" data-testid="demo-esc" onClick={stop}>
            Esc to close
          </Button>
        </div>
      </div>
    </div>
  );
}

export function useDemoShortcut(start: () => void, active: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'g' || e.ctrlKey || e.metaKey || e.altKey || active) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start, active]);
}
