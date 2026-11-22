import { ArrowRight, CircleCheck, OctagonAlert, Search } from 'lucide-react';
import { useState } from 'react';
import { PartImage } from '@/components/PartImage';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import { BOM_COLLECTORS, BOM_STANDARD, GENERIC_ICON, bomPart, partFor, type BomItem, type PartInfo } from '@/lib/parts';
import type { IssueRow, Overview } from '@/lib/types';

export type PartStatus = 'short' | 'ok' | 'review';

export const partStatus = (i: IssueRow): PartStatus => (typeof i.shortage !== 'number' ? 'review' : i.shortage > 0 ? 'short' : 'ok');

const STATUS = {
  short: { word: 'Short', Icon: OctagonAlert, chip: 'bg-risk-tint text-risk', num: 'text-risk' },
  ok: { word: 'OK', Icon: CircleCheck, chip: 'bg-ok-tint text-ok', num: 'text-ok' },
  review: { word: 'Review', Icon: Search, chip: 'bg-warn-tint text-warn', num: 'text-warn' },
} as const;

/* The part an issue is about: a material id on the row if it resolves, else the title keywords. Presentation only. */
export const issuePart = (i: IssueRow): PartInfo => {
  const byId = /cmp-/i.test(i.id) ? partFor(i.id) : null;
  return byId && byId.key !== 'generic' ? byId : partFor((i.title || '').split(':')[0]);
};

const sameFamily = (a: string, b: string) => a === b || (a.endsWith('leaflet') && b.endsWith('leaflet'));

function StatusChip({ st }: { st: PartStatus }) {
  const { word, Icon, chip } = STATUS[st];
  return (
    <span data-testid="part-chip" className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 text-[13px] leading-6 font-medium', chip)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {word}
    </span>
  );
}

export function PartTile({ issue, selected, onSelect }: { issue: IssueRow; selected?: boolean; onSelect?: (id: string) => void }) {
  const st = partStatus(issue);
  const part = issuePart(issue);
  const title = part.key === 'generic' ? (issue.title || 'Part').split(':')[0] : part.name;
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <PartImage part={part} size={40} />
          <span className="min-w-0 truncate text-[15px] font-semibold text-ink">{title}</span>
        </span>
        <StatusChip st={st} />
      </span>
      <span className={cn('num text-[34px] leading-10 font-semibold tracking-[-0.02em]', STATUS[st].num)}>{st === 'review' ? 'unknown' : num(issue.shortage)}</span>
      <span className="text-[13px] leading-5 text-ink-3">{st === 'short' ? 'short' : st === 'ok' ? 'covered' : 'to check'}</span>
    </>
  );
  const cls = cn('lift grid min-w-0 gap-0.5 rounded-card border bg-white p-4 text-left shadow-card', selected ? 'border-brand ring-1 ring-brand' : 'border-line');
  return onSelect ? (
    <button type="button" data-testid="part-tile" data-status={st} aria-pressed={!!selected} onClick={() => onSelect(issue.id)} className={cls}>
      {body}
    </button>
  ) : (
    <div data-testid="part-tile" data-status={st} className={cls}>
      {body}
    </div>
  );
}

type Bom = 'collectors' | 'standard';
const box = (name: string, file: string): PartInfo => ({ key: 'generic', name, img: `/img/${file}.png`, icon: GENERIC_ICON });
const BOMS: Record<Bom, { label: string; items: BomItem[]; box: PartInfo }> = {
  collectors: { label: "Collector's", items: BOM_COLLECTORS, box: box("Collector's edition", 'box-collectors') },
  standard: { label: 'Standard', items: BOM_STANDARD, box: box('Standard edition', 'box-standard') },
};

const cardCls = 'grid h-full w-full min-w-0 content-start justify-items-center gap-1 rounded-card border bg-white p-2.5 text-center shadow-card';

function BomCard({ item, issues, selected, onSelect }: { item: BomItem; issues: IssueRow[]; selected?: string | null; onSelect?: (id: string) => void }) {
  const part = bomPart(item);
  const issue = issues.find((i) => sameFamily(issuePart(i).key, part.key));
  const st = issue ? partStatus(issue) : null;
  const body = (
    <>
      <PartImage part={part} size={64} />
      <span className="text-[13px] leading-4 font-semibold text-ink">{part.name}</span>
      <span className="num text-[13px] leading-4 text-ink-3">{`x${item.qty}`}</span>
      {st ? (
        <span className="flex flex-wrap items-center justify-center gap-1">
          <StatusChip st={st} />
          {st === 'short' ? <span className={cn('num text-[13px] font-semibold', STATUS.short.num)}>{num(issue!.shortage)}</span> : null}
        </span>
      ) : null}
    </>
  );
  const cls = cn(cardCls, issue && selected === issue.id ? 'border-brand ring-1 ring-brand' : 'border-line');
  return issue && onSelect ? (
    <button type="button" data-testid="bom-card" data-part={part.key} data-status={st} onClick={() => onSelect(issue.id)} className={cn(cls, 'lift')}>
      {body}
    </button>
  ) : (
    <div data-testid="bom-card" data-part={part.key} data-status={st ?? 'none'} className={cls}>
      {body}
    </div>
  );
}

export function BomPanel({ issues = [], selected, onSelect }: { issues?: IssueRow[]; selected?: string | null; onSelect?: (id: string) => void }) {
  const [which, setWhich] = useState<Bom>('collectors');
  const b = BOMS[which];
  return (
    <div className="grid min-w-0 gap-3 rounded-card border border-line bg-white p-4 shadow-card sm:p-5" data-testid="bom-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-[15px] font-semibold text-ink">What goes in the box</h3>
        <div role="group" aria-label="Edition" className="inline-flex rounded-full bg-brand-tint p-0.5">
          {(Object.keys(BOMS) as Bom[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={which === k}
              onClick={() => setWhich(k)}
              className={cn('min-h-9 rounded-full px-3 text-[13px] font-semibold transition-colors', which === k ? 'bg-brand text-white' : 'text-brand-deep hover:text-brand')}
            >
              {BOMS[k].label}
            </button>
          ))}
        </div>
      </div>
      <ul data-testid="bom-row" className="m-0 grid list-none grid-cols-2 gap-3 p-0 md:flex md:flex-wrap md:items-stretch md:gap-x-1 md:gap-y-3 xl:flex-nowrap">
        {b.items.map((it) => (
          <li key={`${it.id}-${it.as ?? ''}`} className="flex min-w-0 items-center gap-1 md:w-[112px] xl:w-auto xl:flex-1">
            <div className="min-w-0 flex-1">
              <BomCard item={it} issues={issues} selected={selected} onSelect={onSelect} />
            </div>
            <ArrowRight className="hidden size-4 shrink-0 text-ink-3 md:block" aria-hidden="true" />
          </li>
        ))}
        <li className="col-span-2 flex min-w-0 items-stretch md:col-span-1 md:w-[160px] xl:w-auto xl:flex-[1.5]">
          <div data-testid="bom-box" className={cn(cardCls, 'content-center border-brand/30 bg-brand-tint p-3')}>
            <img data-testid="bom-box-image" src={b.box.img!} alt={b.box.name} height={120} loading="lazy" className="h-[96px] w-auto max-w-full object-contain sm:h-[120px]" />
            <span className="text-[14px] leading-5 font-semibold text-brand-deep">{b.box.name}</span>
          </div>
        </li>
      </ul>
    </div>
  );
}

/* What is short: one tile per case. Names, numbers, chips only. */
export function Parts({ o, selected, onSelect }: { o: Overview; selected?: string | null; onSelect?: (id: string) => void }) {
  const issues = o.issues || [];
  return (
    <section data-testid="parts" aria-label="What is short" className="grid min-w-0 grid-cols-1 content-start gap-4">
      <h2 className="m-0 text-[20px] leading-7 font-semibold tracking-[-0.01em] text-ink">What is short</h2>
      {issues.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {issues.map((i) => (
            <PartTile key={i.id} issue={i} selected={selected === i.id} onSelect={onSelect} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* Full-width section: what goes in the box, below the decision row. */
export function BomSection({ o, selected, onSelect }: { o: Overview; selected?: string | null; onSelect?: (id: string) => void }) {
  return (
    <section data-testid="bom-section" aria-label="What goes in the box" className="min-w-0">
      <BomPanel issues={o.issues || []} selected={selected} onSelect={onSelect} />
    </section>
  );
}
