import { ChevronRight } from 'lucide-react';
import { eur, NB, num } from '@/lib/format';
import type { Transport, TransportLane, TransportMode } from '@/lib/types';

const TZ = 'Europe/Berlin';
const fmt = (o: Intl.DateTimeFormatOptions, v?: string | null): string => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).format(d).replace(/,/g, '');
};
/* "Tue 14:00" */
export const arrivalText = (v?: string | null): string => fmt({ weekday: 'short', hour: '2-digit', minute: '2-digit' }, v);
/* "Sunday 20:00" */
export const deadlineText = (v?: string | null): string => fmt({ weekday: 'long', hour: '2-digit', minute: '2-digit' }, v);
const asOfText = (v?: string | null): string => fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, v);

const span = (h: number): string => {
  const a = Math.abs(h);
  if (a >= 48) {
    const d = Math.round(a / 24);
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  return `${Math.max(1, Math.round(a))}${NB}h`;
};

/* negative margin = too late */
export function marginText(m: TransportMode): string {
  const at = arrivalText(m.arrives_at);
  const h = m.hours_margin;
  const tail = typeof h !== 'number' || !Number.isFinite(h) ? (m.feasible ? 'makes it' : 'too late') : h < 0 ? `${span(h)} late` : `makes it, ${span(h)} to spare`;
  return at ? `arrives ${at}, ${tail}` : tail;
}

const cap = (s?: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : '');

export function costText(m: TransportMode): string {
  const c = m.cost_eur;
  if (!c || typeof c.base !== 'number') return '';
  const lo = typeof c.low === 'number' ? c.low : null;
  const hi = typeof c.high === 'number' ? c.high : null;
  const range = lo != null && hi != null && num(lo) !== num(hi) ? ` (${num(lo)} to ${num(hi)})` : '';
  return `about ${eur(c.base)}${range}`;
}

function fastestMode(l: TransportLane): TransportMode | undefined {
  const ms = l.modes || [];
  return ms.find((m) => m.mode === l.fastest) || [...ms].filter((m) => typeof m.transit_days === 'number').sort((a, b) => a.transit_days! - b.transit_days!)[0];
}

function laneHeadline(l: TransportLane, t: Transport): string | null {
  const ms = l.modes || [];
  if (!ms.length || ms.some((m) => m.feasible)) return null;
  const dl = deadlineText(t.deadline);
  const f = fastestMode(l);
  const h = f?.hours_margin;
  const late = typeof h === 'number' && h < 0 ? `, ${span(h)} late` : '';
  return `No transport mode arrives${dl ? ` before ${dl}` : ' in time'}.${f?.mode ? ` Fastest: ${f.mode}${late}.` : ''}`;
}

const tag = 'rounded-md border border-line-2 px-2 text-ink-2';

function ModeRow({ m, l }: { m: TransportMode; l: TransportLane }) {
  const fastest = !!m.mode && m.mode === l.fastest;
  const cheapest = !!m.mode && m.mode === l.cheapest_feasible && !!m.feasible;
  const cost = costText(m);
  const perUnit = typeof m.cost_per_unit_eur === 'number' ? new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(m.cost_per_unit_eur) : '';
  return (
    <li data-testid="transport-mode" data-feasible={m.feasible ? 'yes' : 'no'} className={`grid gap-1 border-t border-line py-3 text-[14px] leading-5 first:border-t-0 sm:grid-cols-[6rem_1fr] sm:gap-x-4 ${m.feasible ? '' : 'text-ink-2'}`}>
      <b className={m.feasible ? 'font-semibold text-ink' : 'font-medium'}>{cap(m.mode) || 'Mode'}</b>
      <div className="grid gap-1">
        {fastest || cheapest ? (
          <p className="m-0 flex flex-wrap gap-2">
            {fastest ? <span className={tag}>Fastest</span> : null}
            {cheapest ? <span className={tag}>Cheapest that makes it</span> : null}
          </p>
        ) : null}
        {m.route ? <p className="m-0 text-ink-2">{m.route}</p> : null}
        <p className={`m-0 ${m.feasible ? 'text-ink' : 'text-ink-2'}`}>{marginText(m)}</p>
        {cost ? (
          <p className="m-0">
            <span className="text-ink-3">Estimate:</span> {cost}
            {perUnit ? <span className="text-ink-3">{`, about EUR${NB}${perUnit} per unit`}</span> : null}
          </p>
        ) : (
          <p className="m-0 text-ink-3">Cost estimate not available</p>
        )}
        {!m.feasible && m.verdict ? <p className="m-0 text-ink-2">{m.verdict}</p> : null}
      </div>
    </li>
  );
}

function Lane({ l, t }: { l: TransportLane; t: Transport }) {
  const head = laneHeadline(l, t);
  const meta = [l.country, l.quantity != null ? `${num(l.quantity)} units` : '', l.material].filter(Boolean).join(', ');
  return (
    <section data-testid="transport-lane" className="grid gap-1 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="m-0 text-[15px] leading-6 font-semibold">
        {l.supplier || 'Supplier'}
        {meta ? <span className="font-normal text-ink-2">{`, ${meta}`}</span> : null}
      </h3>
      {head ? (
        <p data-testid="transport-none" className="m-0 max-w-[64ch] font-medium text-risk">
          {head}
        </p>
      ) : null}
      <ul className="m-0 grid list-none p-0">
        {(l.modes || []).map((m, i) => (
          <ModeRow key={`${m.mode}-${i}`} m={m} l={l} />
        ))}
      </ul>
    </section>
  );
}

const hasLanes = (t?: Transport | null): t is Transport => !!t && Array.isArray(t.lanes) && t.lanes.length > 0;

function Assumptions({ t }: { t: Transport }) {
  const as = t.assumptions || [];
  const asOf = asOfText(t.as_of);
  return (
    <details data-testid="transport-how" className="group text-[14px] leading-5">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-ink-3 transition-transform group-open:rotate-90" aria-hidden="true" />
        How we estimated this
      </summary>
      <div className="grid gap-3 pb-2 pl-6">
        {as.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {as.map((a, i) => (
              <li key={i} className="grid gap-0.5">
                <span>
                  <b className="font-medium">{a.label}</b>
                  {a.value ? `: ${a.value}` : ''}
                </span>
                <span className="text-ink-2">
                  {a.kind === 'market' ? 'Market rate' : 'Our assumption'}
                  {a.source ? `. Source: ${a.source}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {t.cross_check?.note ? <p className="m-0 max-w-[64ch] text-ink-2">{t.cross_check.note}</p> : null}
        {asOf ? <p className="m-0 text-ink-3">As of {asOf} (Berlin time).</p> : null}
        <p className="m-0 font-medium">Estimates, not customer data. Confirm freight rates with Soony logistics.</p>
      </div>
    </details>
  );
}

export function TransportSection({ t }: { t?: Transport | null }) {
  if (!hasLanes(t)) return null;
  const dl = deadlineText(t.deadline);
  return (
    <section data-demo="transport" data-testid="transport" aria-label="Transport options" className="grid gap-4 border-t border-line pt-6">
      <div className="grid gap-1">
        <h2 className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">Transport options</h2>
        <p className="m-0 text-[14px] text-ink-2">{`Estimates by transport mode, not quotes${dl ? `. Deadline ${dl}.` : '.'}`}</p>
      </div>
      {t.lanes!.map((l, i) => (
        <Lane key={i} l={l} t={t} />
      ))}
      <Assumptions t={t} />
    </section>
  );
}

/* print: plain text, black on white */
export function TransportPrint({ t }: { t?: Transport | null }) {
  if (!hasLanes(t)) return null;
  return (
    <div data-testid="transport-print">
      <h2 className="mt-[5mm] mb-[2mm] text-[13pt] font-semibold">Transport options (estimates)</h2>
      {t.lanes!.map((l, i) => (
        <div key={i} className="break-inside-avoid">
          <p className="font-semibold">
            {l.supplier || 'Supplier'}
            {l.country ? `, ${l.country}` : ''}
          </p>
          {laneHeadline(l, t) ? <p>{laneHeadline(l, t)}</p> : null}
          <ul className="list-disc pl-[5mm]">
            {(l.modes || []).map((m, j) => (
              <li key={j}>
                {cap(m.mode)}: {marginText(m)}. {costText(m) ? `Estimate ${costText(m)}.` : ''}
                {m.mode === l.fastest ? ' Fastest.' : ''}
                {m.mode === l.cheapest_feasible && m.feasible ? ' Cheapest that makes it.' : ''}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-[9pt]">Estimates, not customer data. Confirm freight rates with Soony logistics.</p>
    </div>
  );
}
