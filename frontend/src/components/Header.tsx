import { Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { NumberTicker } from '@/components/ui/number-ticker';
import { Overline } from '@/components/common';
import { useLaunch } from '@/hooks/useLaunch';
import { useUi } from '@/hooks/useUi';
import { shortLines, nounOf } from '@/lib/derive';
import { dayLabel, deadlineTime, hrs, num } from '@/lib/format';
import type { Detail, Overview } from '@/lib/types';

const shortLabel = (i: { title?: string; shortage?: number }) => `${(i.title || 'Case').split(':')[0]}, ${(i.shortage ?? 0) > 0 ? `${num(i.shortage)} short` : 'check'}`;

export function HoursBar({ o }: { o: Overview }) {
  const left = o.pack_status?.hours_left;
  if (!(typeof left === 'number' && left > 0)) return null;
  const cells = Math.min(48, Math.ceil(left));
  const need = Math.max(0, ...(o.products || []).map((p) => p.hours_needed || 0));
  const filled = need > 0 ? Math.min(cells, Math.ceil(need)) : cells;
  const label = `${hrs(left)} packing left${need > 0 ? `. The tightest edition needs ${hrs(need)}.` : '.'}`;
  return (
    <div data-testid="hours-bar" role="img" aria-label={label} className="flex h-2.5 w-full gap-[2px]">
      {Array.from({ length: cells }, (_, i) => (
        <i key={i} className={i < filled ? 'min-w-0 flex-1 rounded-[2px] bg-accent' : 'min-w-0 flex-1 rounded-[2px] bg-white/20'} />
      ))}
    </div>
  );
}

export function CaseSelect({ o, selected, onChange }: { o: Overview; selected: string | null; onChange: (id: string) => void }) {
  return (
    <select
      data-testid="case-select"
      aria-label="Case"
      value={selected ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-11 w-full max-w-full min-w-0 rounded-control border border-white/25 bg-band px-3 text-[15px] text-band-fg sm:w-auto sm:min-w-64"
    >
      {(o.issues || []).map((i) => (
        <option key={i.id} value={i.id}>
          {shortLabel(i)}
        </option>
      ))}
    </select>
  );
}

export function Header({ d, o }: { d: Detail | null; o: Overview }) {
  const { selected, selectCase } = useLaunch();
  const ui = useUi();
  const lines = d ? shortLines(d) : [];
  const total = lines.reduce((s, l) => s + (l.short || 0), 0);
  const day = dayLabel(o.launch_date, true);
  const time = d ? deadlineTime(d.brief?.deadline) : '';
  const left = o.pack_status?.hours_left;

  let title: ReactNode;
  if (d && lines.length)
    title = (
      <>
        <NumberTicker value={total} className="num text-[36px] leading-[36px] font-semibold tracking-[-0.03em] sm:text-[44px] sm:leading-[44px]" testId="short-count" />{' '}
        <span className="text-[17px] leading-6 text-band-fg sm:text-[22px] sm:leading-7">{lines.map((l) => l.name).join(' and ')} copies short</span>
      </>
    );
  else if (d && (d.shortage ?? 0) > 0)
    title = (
      <>
        <NumberTicker value={d.shortage ?? 0} className="num text-[36px] leading-[36px] font-semibold tracking-[-0.03em] sm:text-[44px] sm:leading-[44px]" />{' '}
        <span className="text-[17px] leading-6 sm:text-[22px] sm:leading-7">{nounOf(d)} short</span>
      </>
    );
  else title = <span className="text-[22px] leading-7 font-semibold">{d ? 'Needs a check before launch' : 'Nothing is at risk right now'}</span>;

  return (
    <header data-demo="problem" className="on-dark bg-band text-band-fg print:hidden">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 pt-3 pb-6 sm:px-8 sm:pb-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-h-11 flex-1 items-center gap-2 text-[17px] font-semibold sm:order-1 sm:flex-none">
            <span aria-hidden="true" className="grid size-6 place-items-center rounded-md bg-accent text-band">
              <i className="block h-2.5 w-2.5 rounded-sm bg-band" />
            </span>
            Launch Control
          </div>
          <div className="order-3 w-full sm:order-2 sm:w-auto sm:flex-1">
            <CaseSelect o={o} selected={selected} onChange={selectCase} />
          </div>
          <Button variant="dark" size="sm" id="details" data-testid="details" className="order-2 sm:order-3" onClick={() => ui.openSheet('brief', 'details')}>
            Details
          </Button>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,420px)] lg:items-end">
          <div className="grid gap-2">
            <Overline className="text-band-2">
              Soony · Grand Heist 6{day ? ` · ships ${day}${time ? ` ${time}` : ''}` : ''}
            </Overline>
            <h1 className="m-0 font-semibold">{title}</h1>
          </div>
          <div className="grid gap-2">
            {typeof left === 'number' ? (
              <p className="m-0 flex items-center gap-2 text-[15px] text-band-fg">
                <Clock className="size-4 text-accent" aria-hidden="true" />
                <span>
                  about <NumberTicker value={Math.round(left)} className="num font-semibold" testId="hours-left" /> packing hours left
                </span>
              </p>
            ) : null}
            <HoursBar o={o} />
          </div>
        </div>
      </div>
    </header>
  );
}
