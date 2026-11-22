import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { useWhatIf } from '@/hooks/useWhatIf';
import { whatIfProduct } from '@/lib/derive';
import { hrs, num } from '@/lib/format';
import type { Detail, Overview } from '@/lib/types';

/* packed (ink) | will ship if parts arrive (grey) | short (risk, hatched). Status is also words, never colour alone. */
export function PackingLines({ d, o }: { d: Detail; o: Overview }) {
  const w = useWhatIf();
  const wp = w.available ? whatIfProduct(d, o, w.result) : null;
  const res = w.result;
  return (
    <div className="grid gap-6" id="lanes">
      {(o.products || []).map((p) => {
        const line = (d.allocation?.lines || []).find((l) => l.product_id === p.id);
        let short = (line?.short ?? 0) > 0 ? (line?.short as number) : 0;
        let ships = Math.max(0, (p.remaining || 0) - short);
        if (res && wp && wp.id === p.id) {
          short = res.copies_short || 0;
          ships = res.copies_ship || 0;
        }
        const tight = !!(p.hours_needed && p.hours_available && p.hours_needed / p.hours_available > 0.85);
        const slug = (p.name || 'lane').toLowerCase().replace(/[^a-z]/g, '');
        return (
          <article key={p.id || p.name} data-testid={`lane-${slug}`} className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="m-0 text-[16px] leading-6 font-semibold text-brand-navy">{p.name || 'Edition'}</h3>
              {short > 0 ? (
                <span className="num inline-flex items-center gap-1 rounded-full bg-risk-tint px-2.5 text-[13px] leading-6 font-medium text-risk">
                  <OctagonAlert className="size-3.5" aria-hidden="true" />
                  {num(short)} short
                </span>
              ) : tight ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-warn-tint px-2.5 text-[13px] leading-6 font-medium text-warn">
                  <TriangleAlert className="size-3.5" aria-hidden="true" />
                  tight
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-ok-tint px-2.5 text-[13px] leading-6 font-medium text-ok">
                  <CircleCheck className="size-3.5" aria-hidden="true" />
                  on track
                </span>
              )}
            </div>
            <div
              role="img"
              aria-label={`${num(p.packed)} packed, ${num(ships)} will ship if parts arrive, ${num(short)} short`}
              className="flex h-2.5 w-full overflow-hidden rounded-full bg-line"
            >
              <i className="bg-brand transition-[flex-grow] duration-200" style={{ flexGrow: Math.max(0, p.packed || 0) }} />
              {ships > 0 ? <i className="bg-ship transition-[flex-grow] duration-200" style={{ flexGrow: ships }} /> : null}
              {short > 0 ? <i className="hatch-risk transition-[flex-grow] duration-200" style={{ flexGrow: short }} /> : null}
            </div>
            <p className="num m-0 text-[14px] leading-5 text-ink-2">
              {num(p.packed)} of {num(p.target)} packed.{tight ? ` Needs ${hrs(p.hours_needed)} of ${hrs(p.hours_available)}.` : ''}
            </p>
          </article>
        );
      })}
    </div>
  );
}

export function WhatIfControl({ className }: { className?: string }) {
  const w = useWhatIf();
  if (!w.available) return null;
  return (
    <div className={className ? `grid gap-1 rounded-control bg-brand-tint p-4 ${className}` : 'grid gap-1 rounded-control bg-brand-tint p-4'}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor="whatif-slider" className="text-[14px] text-ink-2">
          Parts arrive
        </label>
        <span className="num text-[14px] font-semibold text-brand-deep" data-testid="whatif-value">
          {w.valueText}
        </span>
      </div>
      <Slider id="whatif-slider" testId="whatif-slider" label="Parts arrive, in hours from now" value={w.hours} onChange={w.setHours} valueText={w.valueText} describedBy="whatif-output" />
      <output id="whatif-output" data-testid="whatif-output" htmlFor="whatif-slider" aria-live="polite" className="text-[16px] leading-6 text-ink">
        {w.sentence}
      </output>
    </div>
  );
}

export function PackingCard({ d, o }: { d: Detail; o: Overview }) {
  return (
    <Card data-demo="packing" aria-label="Packing" className="grid gap-5">
      <h2 className="m-0 text-[20px] leading-7 font-semibold tracking-[-0.01em]">Packing and what-if</h2>
      <PackingLines d={d} o={o} />
      <p className="m-0 flex flex-wrap gap-x-4 text-[14px] text-ink-2" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2 rounded-full bg-brand" />Packed</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2 rounded-full bg-ship" />Will ship</span>
        <span className="inline-flex items-center gap-1.5"><i className="hatch-risk inline-block size-2 rounded-full" />Short</span>
      </p>
      {/* on a phone the slider comes first so it stays on the first screen; strips follow */}
      <WhatIfControl className="max-lg:order-first" />
    </Card>
  );
}
