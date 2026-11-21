import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Unknown } from '@/components/ui/badge';
import { ApproverBadge, Money } from '@/components/common';
import { cn } from '@/lib/cn';
import { gainsKnown, isRecommended, potentialText } from '@/lib/derive';
import { etaText, num } from '@/lib/format';
import type { Detail, Option } from '@/lib/types';

function feasibility(x: Option): { text: string; risk: boolean } {
  if (x.feasible === 'na' || x.kind === 'allocation' || x.kind === 'verify') return { text: x.kind === 'allocation' ? 'decision' : 'to confirm', risk: false };
  if (x.feasible === 'yes') return { text: 'on time', risk: false };
  if (x.feasible === 'late') return { text: 'too late', risk: true };
  return { text: 'unconfirmed', risk: false };
}

/* one-line row; expands to the facts. Honesty rules: gains only when real, unknown stays 'unknown'. */
export function OptionRow({ x, d, open: openInit = false }: { x: Option; d: Detail; open?: boolean }) {
  const [open, setOpen] = useState(openInit);
  const gains = gainsKnown(x) ? x.copies_gained : null;
  const potential = gains == null ? potentialText(x) : null;
  const rec = isRecommended(x, d);
  const f = feasibility(x);
  return (
    <div data-testid="option-card" className="border-t border-line first:border-t-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-12 w-full items-center gap-3 py-2 text-left">
        <ChevronRight className={cn('size-4 shrink-0 text-ink-3 transition-transform duration-200', open && 'rotate-90')} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{x.title || 'Option'}</span>
        {rec ? <span className="text-[14px] text-ok">recommended</span> : null}
        <span className="shrink-0 text-[14px]">{x.price_eur != null ? <Money v={x.price_eur} /> : <Unknown />}</span>
      </button>
      {open ? (
        <div className="grid gap-2 pb-4 pl-7 text-[14px] leading-5">
          {x.detail ? <p className="m-0 max-w-[64ch] text-ink-2">{x.detail}</p> : null}
          <p className="m-0 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-ink-2">Arrives</span>
            {x.eta ? <b className="num font-semibold">{etaText(x.eta)}</b> : <Unknown />}
            <span className="text-ink-2">Approver</span>
            <ApproverBadge a={x.approver} />
            <span className={f.risk ? 'text-risk' : 'text-ink-2'}>{f.text}</span>
          </p>
          {gains != null ? (
            <p className="m-0">
              Copies gained <b className="num font-semibold">{num(gains)}</b>
            </p>
          ) : null}
          {potential ? <p className="m-0 text-ink-2">{potential[0].toUpperCase() + potential.slice(1)}.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function OptionList({ d, expanded = false }: { d: Detail; expanded?: boolean }) {
  const all = d.options || [];
  const rest = expanded ? all : all.filter((x) => !isRecommended(x, d));
  const [open, setOpen] = useState(false);
  if (!rest.length) return null;
  const body = (
    <div className="grid" data-testid="option-list">
      {rest.map((x, i) => (
        <OptionRow key={`${x.title}-${i}`} x={x} d={d} />
      ))}
    </div>
  );
  if (expanded) return <div data-demo="options-sheet">{body}</div>;
  return (
    <div data-demo="options" className="border-t border-line pt-4">
      <button
        type="button"
        data-testid="options-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between text-left font-medium"
      >
        Other options ({rest.length})
        <ChevronRight className={cn('size-4 text-ink-3 transition-transform duration-200', open && 'rotate-90')} aria-hidden="true" />
      </button>
      {open ? body : null}
    </div>
  );
}

export function HoldNote({ d }: { d: Detail }) {
  const hs = (d.holds || []).filter((x) => x && (x.supplier || x.quantity != null));
  if (!hs.length) return null;
  return (
    <div data-demo="hold" className="grid">
      {hs.map((x, i) => (
        <section key={i} data-testid="hold" className="grid gap-2 border-t border-line py-6 first:pt-8">
          <h3 className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">
            {x.supplier || 'A supplier'} is holding {x.quantity != null ? `${num(x.quantity)} units` : 'units'}.
          </h3>
          <p className="m-0 max-w-[64ch] text-ink-2">{x.required_action || 'Packed on hold until Soony confirms delivery terms.'}</p>
          {x.consequence ? <p className="m-0 max-w-[64ch] text-[14px] leading-5 text-ink-2">{x.consequence}</p> : null}
          <p className="m-0 flex flex-wrap items-baseline gap-x-3 text-[14px]">
            {x.who_can_unlock?.role ? (
              <>
                <span className="text-ink-2">Can unlock</span>
                <ApproverBadge a={x.who_can_unlock} />
              </>
            ) : null}
            {x.needs_review ? <span className="text-ink-2">needs review</span> : null}
          </p>
        </section>
      ))}
    </div>
  );
}
