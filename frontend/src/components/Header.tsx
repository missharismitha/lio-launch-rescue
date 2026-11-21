import type { ReactNode } from 'react';
import { NumberTicker } from '@/components/ui/number-ticker';
import { Button } from '@/components/ui/button';
import { useLaunch } from '@/hooks/useLaunch';
import { useUi } from '@/hooks/useUi';
import { shortLines, nounOf } from '@/lib/derive';
import { dayLong, deadlineTime, hrs, num } from '@/lib/format';
import type { Detail, Overview } from '@/lib/types';

const optionLabel = (i: { title?: string; shortage?: number }) => `${(i.title || 'Case').split(':')[0]}, ${(i.shortage ?? 0) > 0 ? `${num(i.shortage)} short` : 'check'}`;

export function CaseSelect({ o, selected, onChange }: { o: Overview; selected: string | null; onChange: (id: string) => void }) {
  return (
    <select
      data-testid="case-select"
      aria-label="Case"
      value={selected ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-11 max-w-full min-w-0 cursor-pointer border-0 border-b border-line-2 bg-transparent py-0 pr-1 text-[15px] text-ink"
    >
      {(o.issues || []).map((i) => (
        <option key={i.id} value={i.id}>
          {optionLabel(i)}
        </option>
      ))}
    </select>
  );
}

/* a thin track: ink = the hours the tightest edition needs, grey = slack, within the hours left */
export function HoursLine({ o }: { o: Overview }) {
  const left = o.pack_status?.hours_left;
  if (!(typeof left === 'number' && left > 0)) return null;
  const tight = [...(o.products || [])].sort((a, b) => (b.hours_needed || 0) - (a.hours_needed || 0))[0];
  const need = tight?.hours_needed || 0;
  const pct = need > 0 ? Math.min(100, (need / left) * 100) : 100;
  const label = `${hrs(left)} packing left${need > 0 ? `. The tightest edition needs ${hrs(need)}.` : '.'}`;
  return (
    <div className="grid max-w-[560px] gap-2">
      <p className="m-0 text-ink" data-testid="hours-line">
        <NumberTicker value={Math.round(left)} className="num font-semibold" testId="hours-left" /> hours of packing left
      </p>
      <div data-testid="hours-bar" role="img" aria-label={label} className="h-[3px] w-full rounded-full bg-line">
        <div className="h-full rounded-full bg-ink transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
      {need > 0 && tight?.name ? (
        <p className="m-0 text-[14px] leading-5 text-ink-2">
          The {tight.name} edition needs <span className="num">{Math.round(need)}</span> of them.
        </p>
      ) : null}
    </div>
  );
}

export function Header({ d, o }: { d: Detail | null; o: Overview }) {
  const { selected, selectCase } = useLaunch();
  const ui = useUi();
  const lines = d ? shortLines(d) : [];
  const total = lines.reduce((s, l) => s + (l.short || 0), 0);
  const day = dayLong(o.launch_date);
  const time = d ? deadlineTime(d.brief?.deadline) : '';
  const numeral = 'num text-[52px] leading-[52px] font-semibold tracking-[-0.04em] sm:text-[72px] sm:leading-[72px]';

  let hero: ReactNode;
  if (d && lines.length)
    hero = (
      <>
        <NumberTicker value={total} className={numeral} testId="short-count" />
        <span className="text-[18px] leading-7 text-ink-2 sm:text-[22px] sm:leading-[30px]">{lines.map((l) => l.name).join(' and ')} copies short</span>
      </>
    );
  else if (d && (d.shortage ?? 0) > 0)
    hero = (
      <>
        <NumberTicker value={d.shortage ?? 0} className={numeral} />
        <span className="text-[18px] leading-7 text-ink-2 sm:text-[22px] sm:leading-[30px]">{nounOf(d)} short</span>
      </>
    );
  else hero = <span className="text-[30px] leading-[38px] font-semibold tracking-[-0.01em]">{d ? 'Needs a check before launch' : 'Nothing is at risk right now'}</span>;

  return (
    <>
      <header className="border-b border-line print:hidden">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-6 px-4 sm:px-8">
          <span className="flex min-h-11 flex-1 items-center text-[15px] font-semibold tracking-[-0.01em] sm:order-1 sm:flex-none">Launch Control</span>
          <div className="order-3 w-full sm:order-2 sm:w-auto sm:flex-1">
            <CaseSelect o={o} selected={selected} onChange={selectCase} />
          </div>
          <Button variant="ghost" size="sm" id="details" data-testid="details" className="order-2 -mr-3 sm:order-3" onClick={() => ui.openSheet('brief', 'details')}>
            Details
          </Button>
        </div>
      </header>
      <section data-demo="problem" className="mx-auto grid max-w-[1120px] gap-3 px-4 pt-8 pb-8 sm:px-8 sm:pt-[72px] sm:pb-14">
        <p className="m-0 text-ink-2">
          Soony, Grand Heist 6.{day ? ` Ships ${day}${time ? `, ${time}` : ''}.` : ''}
        </p>
        <h1 className="m-0 flex flex-wrap items-baseline gap-x-5 gap-y-1">{hero}</h1>
        <div className="mt-3">
          <HoursLine o={o} />
        </div>
      </section>
    </>
  );
}
