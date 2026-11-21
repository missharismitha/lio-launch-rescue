import { ChevronRight, Truck } from 'lucide-react';
import { useState } from 'react';
import { Badge, Dot, Unknown } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ApproverBadge, Money } from '@/components/common';
import { cn } from '@/lib/cn';
import { gainsKnown, isRecommended, potentialText } from '@/lib/derive';
import { etaText, num } from '@/lib/format';
import type { Detail, Option } from '@/lib/types';

function Feasibility({ x }: { x: Option }) {
  const na = x.feasible === 'na' || x.kind === 'allocation' || x.kind === 'verify';
  if (na) return <Badge><Dot />{x.kind === 'allocation' ? 'Decision' : 'To confirm'}</Badge>;
  if (x.feasible === 'yes') return <Badge tone="ok"><Dot />On time</Badge>;
  if (x.feasible === 'late') return <Badge tone="risk"><Dot />Too late</Badge>;
  return <Badge><Dot />Unconfirmed</Badge>;
}

/* one-line Card row; expands to the facts. Honesty rules: gains only when real, unknown stays 'unknown'. */
export function OptionRow({ x, d, open: openInit = false }: { x: Option; d: Detail; open?: boolean }) {
  const [open, setOpen] = useState(openInit);
  const gains = gainsKnown(x) ? x.copies_gained : null;
  const potential = gains == null ? potentialText(x) : null;
  const rec = isRecommended(x, d);
  return (
    <Card data-testid="option-card" className="overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-page"
      >
        <ChevronRight className={cn('size-4 shrink-0 text-ink-2 transition-transform duration-200', open && 'rotate-90')} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-semibold">{x.title || 'Option'}</span>
        {rec ? <Badge tone="ok">Recommended</Badge> : null}
        <span className="shrink-0 text-[14px]">{x.price_eur != null ? <Money v={x.price_eur} /> : <Unknown />}</span>
      </button>
      {open ? (
        <div className="grid gap-2 border-t border-line px-4 py-3 text-[14px]">
          {x.detail ? <p className="m-0">{x.detail}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Truck className="size-4 text-ink-2" aria-hidden="true" />
            {x.eta ? <b className="num">{etaText(x.eta)}</b> : <Unknown />}
            <ApproverBadge a={x.approver} />
            <Feasibility x={x} />
          </div>
          {gains != null ? (
            <p className="m-0">
              Copies gained <b className="num">{num(gains)}</b>
            </p>
          ) : null}
          {potential ? <p className="m-0 text-ink-2">{potential[0].toUpperCase() + potential.slice(1)}.</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

export function OptionList({ d, expanded = false }: { d: Detail; expanded?: boolean }) {
  const all = d.options || [];
  const rest = expanded ? all : all.filter((x) => !isRecommended(x, d));
  const [open, setOpen] = useState(false);
  if (!rest.length) return null;
  const body = (
    <div className="grid gap-2" data-testid="option-list">
      {rest.map((x, i) => (
        <OptionRow key={`${x.title}-${i}`} x={x} d={d} />
      ))}
    </div>
  );
  if (expanded) return <div data-demo="options-sheet">{body}</div>;
  return (
    <div data-demo="options" className="grid gap-2">
      <button
        type="button"
        data-testid="options-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between rounded-control border border-line-2 bg-card px-4 text-left font-semibold hover:bg-page"
      >
        Other options ({rest.length})
        <ChevronRight className={cn('size-4 text-ink-2 transition-transform duration-200', open && 'rotate-90')} aria-hidden="true" />
      </button>
      {open ? body : null}
    </div>
  );
}

export function HoldNote({ d }: { d: Detail }) {
  const hs = (d.holds || []).filter((x) => x && (x.supplier || x.quantity != null));
  if (!hs.length) return null;
  return (
    <div data-demo="hold" className="grid gap-3">
      {hs.map((x, i) => (
        <Card key={i} data-testid="hold" className="grid gap-1.5 border-l-4 border-l-risk p-4">
          <b>
            {x.supplier || 'A supplier'} is holding {x.quantity != null ? `${num(x.quantity)} units` : 'units'}.
          </b>
          <span className="text-ink-2">{x.required_action || 'Packed on hold until Soony confirms delivery terms.'}</span>
          {x.consequence ? <span className="text-ink-2">{x.consequence}</span> : null}
          <span className="flex flex-wrap items-center gap-2">
            {x.who_can_unlock?.role ? (
              <>
                <span className="text-[13px] text-ink-2">Can unlock</span>
                <ApproverBadge a={x.who_can_unlock} />
              </>
            ) : null}
            {x.needs_review ? <Badge tone="warn"><Dot />Needs review</Badge> : null}
          </span>
        </Card>
      ))}
    </div>
  );
}
