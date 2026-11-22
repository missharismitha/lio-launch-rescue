import { AlertTriangle, Bot, Check, ClipboardCheck, Database, FileSearch, MailOpen, Package, Send, ShieldCheck, Timer, Truck } from 'lucide-react';
import { m } from 'motion/react';
import { useEffect, useState, type ComponentType } from 'react';
import { useDemoReplay } from '@/hooks/useDemoReplay';
import { cn } from '@/lib/cn';
import type { Detail, Overview } from '@/lib/types';
import {
  countdownLabel,
  currentStage,
  deadlineText,
  historyRows,
  isPastDeadline,
  nextAction,
  statusHeadline,
  workflowStages,
  type HistoryRow,
  type Stage,
  type StageIcon,
  type Target,
} from '@/lib/workflow';

const ICONS: Record<StageIcon, ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>> = {
  database: Database,
  records: FileSearch,
  problem: AlertTriangle,
  agent: Bot,
  approved: ShieldCheck,
  sent: Send,
  reply: MailOpen,
  offer: ClipboardCheck,
  truck: Truck,
};

const STATE_WORD: Record<Stage['state'], string> = { done: 'done', current: 'in progress', upcoming: 'not yet', blocked: 'needs you' };
const TONE_DOT: Record<HistoryRow['tone'], string> = { ok: 'bg-ok', warn: 'bg-warn', info: 'bg-brand', neutral: 'bg-line-2' };

function scrollTo(target: Target) {
  const el = document.getElementById(target);
  if (!el) return;
  el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const focusable = el.querySelector<HTMLElement>('button:not([disabled]), a[href], input');
  focusable?.focus?.({ preventScroll: true });
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function Circle({ stage, isCurrent }: { stage: Stage; isCurrent: boolean }) {
  const Icon = ICONS[stage.icon];
  const base = 'relative z-10 grid size-11 shrink-0 place-items-center rounded-full border-2 bg-white';
  if (stage.state === 'done')
    return (
      <span className={cn(base, 'border-ok bg-ok text-white')}>
        <Check className="size-5" aria-hidden="true" />
      </span>
    );
  if (stage.state === 'blocked')
    return (
      <span className={cn(base, 'border-warn bg-warn-tint text-warn')}>
        <AlertTriangle className="size-5" aria-hidden="true" />
      </span>
    );
  if (isCurrent && stage.state === 'current')
    return (
      <span className={cn(base, 'border-brand bg-brand-tint')}>
        <span className="size-3.5 rounded-full bg-brand motion-safe:animate-pulse" />
      </span>
    );
  return (
    <span className={cn(base, isCurrent ? 'border-brand text-brand' : 'border-line text-ink-3')}>
      <Icon className="size-5" aria-hidden="true" />
    </span>
  );
}

function Track({ stages, level }: { stages: Stage[]; level: number }) {
  /* guided demo only: replay the connector fill from the first stage to the current one */
  const replay = useDemoReplay('tracking');
  const shown = replay == null ? level : Math.min(level, Math.floor((replay / 0.85) * (level + 1)));
  return (
    <ol className="m-0 flex list-none flex-col p-0 md:flex-row" aria-label="Launch stages">
      {stages.map((s, i) => {
        const isCurrent = i === level;
        const last = i === stages.length - 1;
        const filled = i < shown;
        return (
          <li
            key={s.id}
            data-testid={`stage-${s.id}`}
            data-state={s.state}
            aria-current={isCurrent ? 'step' : undefined}
            className="relative flex min-h-[64px] items-start gap-4 pb-5 md:min-h-0 md:flex-1 md:flex-col md:items-center md:gap-2 md:pb-0 md:text-center"
          >
            {!last ? (
              <>
                <span aria-hidden="true" className="absolute left-[21px] top-[22px] h-full w-[3px] -translate-x-1/2 rounded-full bg-line md:left-1/2 md:top-[21px] md:h-[3px] md:w-full md:translate-x-0" />
                {filled ? (
                  <m.span
                    aria-hidden="true"
                    initial={{ scaleX: 0, scaleY: 0 }}
                    animate={{ scaleX: 1, scaleY: 1 }}
                    transition={{ duration: 0.45, delay: 0.1 + i * 0.09, ease: [0.2, 0.7, 0.2, 1] }}
                    className="absolute left-[21px] top-[22px] h-full w-[3px] origin-top -translate-x-1/2 rounded-full bg-brand md:left-1/2 md:top-[21px] md:h-[3px] md:w-full md:origin-left md:translate-x-0"
                  />
                ) : null}
              </>
            ) : null}
            <div className="relative shrink-0">
              <Circle stage={s} isCurrent={isCurrent} />
              {isCurrent ? (
                <m.span
                  aria-hidden="true"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 + i * 0.09, duration: 0.3 }}
                  className="absolute -right-2 -top-3 z-20 grid size-6 place-items-center rounded-full bg-brand text-white shadow-card"
                  data-testid="package"
                >
                  <Package className="size-3.5" />
                </m.span>
              ) : null}
            </div>
            <div className="min-w-0 pt-0.5 md:pt-0">
              <div className={cn('text-[16px] leading-5 font-semibold', s.state === 'upcoming' && !isCurrent ? 'text-ink-3' : 'text-ink')}>{s.label}</div>
              <div className={cn('text-[13px] leading-[18px]', s.state === 'blocked' ? 'font-medium text-warn' : 'text-ink-3')}>
                {s.sub || ' '}
              </div>
              <span className="sr-only">{STATE_WORD[s.state]}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function History({ rows }: { rows: HistoryRow[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <div className="grid gap-3">
      <h3 className="m-0 text-[16px] leading-6 font-semibold text-ink">Tracking history</h3>
      {rows.length === 0 ? (
        <ul className="m-0 grid list-none gap-3 p-0" data-testid="history-empty">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 text-ink-3">
              <span className="w-[72px] shrink-0 text-[14px]">--</span>
              <span className="size-2.5 shrink-0 rounded-full bg-line" aria-hidden="true" />
              <span className="text-[15px]">No updates yet</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="m-0 grid list-none gap-0 p-0" data-testid="history">
          {shown.map((r, i) => (
            <li key={r.id} className="relative flex items-start gap-3 pb-3">
              {i < shown.length - 1 ? <span aria-hidden="true" className="absolute left-[calc(72px+0.75rem+4.5px)] top-4 h-full w-px bg-line" /> : null}
              <span className="w-[72px] shrink-0 text-[14px] leading-5 text-ink-3 num">{r.time || '--'}</span>
              <span className={cn('relative z-10 mt-[5px] size-2.5 shrink-0 rounded-full', TONE_DOT[r.tone])} aria-hidden="true" />
              <span className="text-[15px] leading-5 text-ink">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 5 ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="justify-self-start rounded-control text-[15px] font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {all ? 'Show less' : `Show all ${rows.length}`}
        </button>
      ) : null}
    </div>
  );
}

/* Package-tracking view of the whole workflow: headline, estimate, stage track, history. */
export function WorkflowTracker({ d, o }: { d: Detail; o: Overview }) {
  const now = useNow();
  const stages = workflowStages(d, o);
  const level = currentStage(d, o);
  const cur = stages[level];
  const headline = statusHeadline(d, o);
  const action = nextAction(d);
  const left = countdownLabel(now, o.launch_date);
  const late = isPastDeadline(now, o.launch_date);
  const est = deadlineText(o.launch_date);
  const blocked = cur?.state === 'blocked';
  const title = (d.title || '').trim();

  return (
    <section
      id="workflow"
      data-demo="tracking"
      data-testid="workflow-tracker"
      aria-label="Launch tracking"
      className="grid gap-6 rounded-[16px] bg-white p-5 shadow-card sm:p-7"
    >
      <header className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold uppercase tracking-wide text-ink-3">Launch tracking</span>
            {title ? <span className="max-w-full truncate rounded-full bg-brand-tint px-3 py-0.5 text-[13px] font-medium text-brand-deep">{title}</span> : null}
          </div>
          <h2 data-testid="workflow-headline" className="m-0 text-[26px] leading-8 font-semibold tracking-[-0.01em] text-ink text-balance sm:text-[32px] sm:leading-10">
            {headline}
          </h2>
        </div>
        {est ? (
          <div className="grid gap-0.5 md:text-right">
            <span className="text-[13px] text-ink-3">Estimated</span>
            <span className="text-[22px] leading-7 font-semibold text-ink num">{est}</span>
            {left ? (
              <span aria-live="off" data-testid="countdown" className={cn('inline-flex items-center gap-1.5 text-[15px] font-medium num md:justify-end', late ? 'text-risk' : 'text-brand')}>
                <Timer className="size-4" aria-hidden="true" />
                {left}
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      <Track stages={stages} level={level} />

      {cur ? (
        <div data-testid="workflow-callout" className={cn('flex flex-wrap items-center justify-between gap-3 rounded-[12px] px-4 py-3', blocked ? 'bg-warn-tint' : 'bg-brand-tint')}>
          <p className="m-0 text-[16px] leading-6 text-ink">
            <span className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">Next</span>
            <br />
            {action.text}
          </p>
          <button
            type="button"
            onClick={() => scrollTo(action.target)}
            className={cn('rounded-control text-[15px] font-semibold underline-offset-4 hover:underline focus-visible:outline-2', blocked ? 'text-warn' : 'text-brand')}
          >
            {action.button}
          </button>
        </div>
      ) : null}

      <History rows={historyRows(d.events)} />
    </section>
  );
}
