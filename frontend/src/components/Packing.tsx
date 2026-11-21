import { Badge, Dot } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { useWhatIf } from '@/hooks/useWhatIf';
import { whatIfProduct } from '@/lib/derive';
import { hrs, num } from '@/lib/format';
import type { Detail, Overview } from '@/lib/types';

/* packed (ink) | will ship if parts arrive (green) | short (hatched red). Status is also text, never colour alone. */
export function PackingLines({ d, o }: { d: Detail; o: Overview }) {
  const w = useWhatIf();
  const wp = w.available ? whatIfProduct(d, o, w.result) : null;
  const res = w.result;
  return (
    <div className="grid gap-3" id="lanes">
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
          <article key={p.id || p.name} data-testid={`lane-${slug}`} className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="m-0 text-[15px] font-semibold">{p.name || 'Edition'}</h3>
              {short > 0 ? (
                <Badge tone="risk">
                  <Dot />
                  {num(short)} short
                </Badge>
              ) : tight ? (
                <Badge tone="warn">
                  <Dot />
                  Tight
                </Badge>
              ) : (
                <Badge tone="ok">
                  <Dot />
                  On track
                </Badge>
              )}
            </div>
            <div
              role="img"
              aria-label={`${num(p.packed)} packed, ${num(ships)} will ship if parts arrive, ${num(short)} short`}
              className="flex h-3 w-full overflow-hidden rounded-full bg-line"
            >
              <i className="bg-ink transition-[flex-grow] duration-200" style={{ flexGrow: Math.max(0, p.packed || 0) }} />
              {ships > 0 ? <i className="bg-ok transition-[flex-grow] duration-200" style={{ flexGrow: ships }} /> : null}
              {short > 0 ? <i className="hatch-risk bg-risk-wash transition-[flex-grow] duration-200" style={{ flexGrow: short }} /> : null}
            </div>
            <p className="num m-0 text-[13px] text-ink-2">
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
    <div className={className ? `grid gap-1 ${className}` : 'grid gap-1'}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor="whatif-slider" className="text-[13px] font-semibold text-ink-2">
          Parts arrive
        </label>
        <span className="num text-[13px] font-semibold" data-testid="whatif-value">
          {w.valueText}
        </span>
      </div>
      <Slider id="whatif-slider" testId="whatif-slider" label="Parts arrive, in hours from now" value={w.hours} onChange={w.setHours} valueText={w.valueText} describedBy="whatif-output" />
      <output id="whatif-output" data-testid="whatif-output" htmlFor="whatif-slider" aria-live="polite" className="text-[15px] font-semibold">
        {w.sentence}
      </output>
    </div>
  );
}

export function PackingCard({ d, o }: { d: Detail; o: Overview }) {
  return (
    <Card data-demo="packing" aria-label="Packing" className="grid gap-4 p-5 sm:p-6">
      <PackingLines d={d} o={o} />
      <p className="m-0 flex flex-wrap gap-x-3 text-[12px] text-ink-2" aria-hidden="true">
        <span className="inline-flex items-center gap-1"><i className="inline-block size-2 rounded-full bg-ink" />Packed</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block size-2 rounded-full bg-ok" />Will ship</span>
        <span className="inline-flex items-center gap-1"><i className="hatch-risk inline-block size-2 rounded-full bg-risk" />Short</span>
      </p>
      {/* on a phone the slider comes first so it stays on the first screen; strips follow */}
      <WhatIfControl className="max-lg:order-first" />
    </Card>
  );
}
