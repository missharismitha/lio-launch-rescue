import { CircleCheck, CircleX, X } from 'lucide-react';
import { marginText } from '@/components/Transport';
import { PartImage } from '@/components/PartImage';
import { eur, num } from '@/lib/format';
import { partFor } from '@/lib/parts';
import type { MapSupplier, Transport, TransportLane, TransportMode } from '@/lib/types';
import { ModeChip } from './ModeChip';

export function estCost(m: TransportMode): string {
  const c = m.cost_eur;
  if (!c) return '';
  const lo = typeof c.low === 'number' ? c.low : null;
  const hi = typeof c.high === 'number' ? c.high : null;
  if (lo != null && hi != null && num(lo) !== num(hi)) return `est. ${eur(lo)} to ${num(hi)}`;
  const v = typeof c.base === 'number' ? c.base : (lo ?? hi);
  return typeof v === 'number' ? `est. ${eur(v)}` : '';
}

const badge = 'rounded-full border border-brand/30 bg-brand-tint px-2 py-0.5 text-[12px] leading-4 font-semibold text-brand-deep';

export function SupplierPanel({ supplier, lane, transport, onClose }: { supplier: MapSupplier; lane?: TransportLane; transport?: Transport; onClose: () => void }) {
  const modes = lane?.modes || [];
  const none = modes.length > 0 && !modes.some((m) => m.feasible);
  return (
    <aside data-testid="map-panel" aria-label={`Transport for ${supplier.name}`} className="grid content-start gap-3 rounded-2xl border border-line bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {lane?.material ? <PartImage part={partFor(lane.material)} size={40} /> : null}
          <div className="grid">
          <h3 className="m-0 text-[16px] leading-6 font-semibold text-ink">{supplier.name}</h3>
          <span className="text-[13px] leading-5 text-ink-2">{[supplier.country, lane?.material].filter(Boolean).join(', ')}</span>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close supplier panel" className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] text-ink-2 hover:bg-page">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {!modes.length ? <p className="m-0 text-[14px] text-ink-3">No transport lane for this supplier</p> : null}
      {none ? (
        <p className="m-0 flex items-center gap-2 text-[14px] font-semibold text-risk">
          <CircleX className="size-4" aria-hidden="true" />
          No mode makes it
        </p>
      ) : null}
      <ul className="m-0 grid list-none gap-2 p-0">
        {modes.map((m, i) => {
          const fastest = !!m.mode && m.mode === lane?.fastest;
          const cheapest = !!m.mode && m.mode === lane?.cheapest_feasible && !!m.feasible;
          const cost = estCost(m);
          return (
            <li key={`${m.mode}-${i}`} data-testid="map-lane-mode" data-feasible={m.feasible ? 'yes' : 'no'} className="grid gap-1.5 rounded-xl border border-line p-3 text-[14px] leading-5">
              <div className="flex flex-wrap items-center gap-2">
                <ModeChip mode={m.mode} />
                {m.feasible ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ok-tint px-2 py-0.5 text-[12px] leading-4 font-semibold text-ok">
                    <CircleCheck className="size-3.5" aria-hidden="true" />
                    Makes it
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-risk-tint px-2 py-0.5 text-[12px] leading-4 font-semibold text-risk">
                    <CircleX className="size-3.5" aria-hidden="true" />
                    Too late
                  </span>
                )}
                {fastest ? <span className={badge}>Fastest</span> : null}
                {cheapest ? <span className={badge}>Cheapest that makes it</span> : null}
              </div>
              <p className="m-0 text-ink">{marginText(m)}</p>
              <p className="m-0 font-medium text-ink">{cost || <span className="font-normal text-ink-3">Cost estimate not available</span>}</p>
              {m.verdict ? <p className="m-0 text-ink-2">{m.verdict}</p> : null}
            </li>
          );
        })}
      </ul>
      {modes.length && transport?.estimate !== false ? <p className="m-0 text-[12px] text-ink-3">Estimates, not quotes</p> : null}
    </aside>
  );
}
