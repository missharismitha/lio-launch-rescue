import { Clock, Play, Rocket } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLaunch } from '@/hooks/useLaunch';
import { useUi } from '@/hooks/useUi';
import { launchCountdown } from '@/lib/countdown';
import { num } from '@/lib/format';
import type { Detail, Overview } from '@/lib/types';

const optionLabel = (i: { title?: string; shortage?: number }) => `${(i.title || 'Case').split(':')[0]}, ${(i.shortage ?? 0) > 0 ? `${num(i.shortage)} short` : 'check'}`;

export function CaseSelect({ o, selected, onChange }: { o: Overview; selected: string | null; onChange: (id: string) => void }) {
  return (
    <select
      data-testid="case-select"
      aria-label="Case"
      value={selected ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-10 max-w-full min-w-0 cursor-pointer rounded-control border border-line bg-white px-2 text-[14px] text-ink"
    >
      {(o.issues || []).map((i) => (
        <option key={i.id} value={i.id}>
          {optionLabel(i)}
        </option>
      ))}
    </select>
  );
}

/* green only when the portal sync worked and has no error; otherwise needs a look. Word and colour. */
export const dataLive = (o: Overview): boolean => !!o.sync?.last_success && !o.sync?.error;

export type DataState = 'live' | 'checking' | 'stale';
/* checking: no sync yet (startup sync pending). stale: error, or last success older than 10 minutes. */
export const dataState = (o: Overview, now: number = Date.now()): DataState => {
  const ok = o.sync?.last_success;
  if (!ok) return 'checking';
  if (o.sync?.error) return 'stale';
  const t = Date.parse(ok);
  if (Number.isFinite(t) && now - t > 10 * 60 * 1000) return 'stale';
  return 'live';
};
const DATA_VIEW: Record<DataState, { word: string; title: string; text: string; dot: string }> = {
  live: { word: 'Data live', title: 'Data synced', text: 'text-ok', dot: 'bg-ok' },
  checking: { word: 'Checking data', title: 'Checking data', text: 'text-ink-2', dot: 'bg-warn animate-pulse' },
  stale: { word: 'Data stale', title: 'Data not confirmed', text: 'text-warn', dot: 'bg-warn' },
};

export function LaunchClock({ date }: { date?: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(t);
  }, []);
  const text = launchCountdown(date, now);
  if (!text) return null;
  const launched = text === 'Launched';
  return (
    <span data-testid="countdown" className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-3 py-1 text-[14px] font-semibold text-brand-deep">
      {launched ? <Rocket className="size-4" aria-hidden="true" /> : <Clock className="size-4" aria-hidden="true" />}
      <span className="num">{launched ? 'Launched' : `Launch in ${text}`}</span>
    </span>
  );
}

export function Header({ d, o }: { d: Detail | null; o: Overview }) {
  const { selected, selectCase } = useLaunch();
  const ui = useUi();
  const v = DATA_VIEW[dataState(o)];
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:gap-x-4 sm:px-8">
        <img src="/img/soony-logo.png" alt="Soony" className="h-7 w-auto shrink-0" />
        <span className="hidden text-[16px] font-semibold tracking-[-0.01em] text-brand-navy sm:inline">Launch Control</span>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <LaunchClock date={o.launch_date} />
          <span data-testid="data-status" title={v.title} className={`hidden items-center gap-1.5 text-[13px] sm:inline-flex ${v.text}`}>
            <i aria-hidden="true" className={`inline-block size-2 rounded-full ${v.dot}`} />
            {v.word}
          </span>
          <span className="sr-only sm:hidden">{v.word}</span>
          <i aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full sm:hidden ${v.dot}`} />
        </div>
        <div className="order-last w-full min-w-0 sm:order-none sm:w-auto">
          <CaseSelect o={o} selected={selected} onChange={selectCase} />
        </div>
        {d ? (
          <Button variant="secondary" size="sm" data-testid="watch-demo" aria-label="Watch demo" className="order-2 sm:order-none" onClick={() => { ui.closeSheet(); ui.setDemoOpen(true); }}>
            <Play className="size-4 fill-current" aria-hidden="true" />
            <span className="sm:hidden">Demo</span>
            <span className="hidden sm:inline">Watch demo</span>
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" id="details" data-testid="details" className="order-2 -mr-2 sm:order-none" onClick={() => ui.openSheet('brief', 'details')}>
          Details
        </Button>
      </div>
    </header>
  );
}
