import { AnimatePresence, m } from 'motion/react';
import { Bot, Check, ChevronDown, CircleX, Hand, LoaderCircle, Minus, RotateCcw, ShieldHalf, Timer, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { groupLabel, railRows, type RailRow } from '@/components/AgentRail';
import { useDemoReplay } from '@/hooks/useDemoReplay';
import { useLaunch } from '@/hooks/useLaunch';
import {
  AUTO_START_MS, autoStartKey, autonomyWord, blockedText, callsText, groupPhases, modeBadge, nowText, offsetSeconds,
  shouldAutoStart, stepMeta, type Phase, type PhaseState, type StepState,
} from '@/lib/agentSteps';
import { approvalsNeeded, cardTitle } from '@/lib/derive';
import type { Autonomy, Detail, Overview } from '@/lib/types';

export interface LiveStep {
  key: string;
  raw: string;
  n: number;
  label: string;
  short: string;
  Icon: LucideIcon;
  state: StepState;
  summary: string;
  autonomy: Autonomy | null;
  rule: boolean;
  tick: string;
}

/* streamed generic labels: every step but the last is done; the last is running while the agent runs */
export function streamSteps(steps: { at?: string | null; message?: string }[] | undefined, running: boolean): LiveStep[] {
  const list = steps || [];
  const first = (list[0] as { at?: string } | undefined)?.at;
  return list.map((s, i) => {
    const label = String(s.message || 'Step');
    const meta = stepMeta(label);
    const off = offsetSeconds((s as { at?: string }).at, first);
    return {
      key: `s${i}`,
      raw: label,
      n: 1,
      label,
      short: meta.short,
      Icon: meta.Icon,
      state: running && i === list.length - 1 ? 'running' : meta.autonomy === 'approval' ? 'approval' : 'done',
      summary: '',
      autonomy: meta.autonomy,
      rule: false,
      tick: off != null ? `+${off}s` : String(i + 1),
    };
  });
}

export function traceSteps(rows: RailRow[]): LiveStep[] {
  return rows.map((r, i) => {
    const meta = stepMeta(r.label);
    return {
      key: `s${i}`,
      raw: r.label,
      n: r.n,
      label: groupLabel(r.label, r.n),
      short: meta.short + (r.n > 1 ? ` x${r.n}` : ''),
      Icon: meta.Icon,
      state: r.rejected ? 'rejected' : r.skipped ? 'skipped' : r.approval ? 'approval' : 'done',
      summary: r.summaries.join('; '),
      autonomy: r.autonomy || meta.autonomy,
      rule: r.rule,
      tick: String(i + 1),
    };
  });
}

/* once per page load per evidence key: module set plus sessionStorage (survives a reload, which is the same tab) */
const started = new Set<string>();
const STORE = 'agent-autostart';
function startedKeys(): string[] {
  let stored: string[] = [];
  try {
    stored = JSON.parse(sessionStorage.getItem(STORE) || '[]');
  } catch {
    /* storage unavailable */
  }
  return [...started, ...(Array.isArray(stored) ? stored : [])];
}
function markStarted(key: string) {
  started.add(key);
  try {
    sessionStorage.setItem(STORE, JSON.stringify([...started]));
  } catch {
    /* storage unavailable */
  }
}
export const resetAutoStartForTests = () => {
  started.clear();
  try {
    sessionStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
};

const NODE: Record<StepState, string> = {
  running: 'border-brand bg-brand-tint text-brand',
  done: 'border-ok-tint bg-ok-tint text-ok',
  approval: 'border-warn-tint bg-warn-tint text-warn',
  rejected: 'border-risk-tint bg-risk-tint text-risk',
  skipped: 'border-line bg-white text-ink-3',
};
const STATE_WORD: Record<StepState, string> = { running: 'Working', done: 'Done', approval: 'Needs approval', rejected: 'Blocked', skipped: 'Skipped' };

function StateIcon({ s }: { s: StepState }) {
  const cls = 'size-4 shrink-0';
  if (s === 'running') return <LoaderCircle aria-hidden="true" className={`${cls} animate-spin text-brand motion-reduce:animate-none`} />;
  if (s === 'approval') return <Hand aria-hidden="true" className={`${cls} text-warn`} />;
  if (s === 'rejected') return <CircleX aria-hidden="true" className={`${cls} text-risk`} />;
  if (s === 'skipped') return <Minus aria-hidden="true" className={`${cls} text-ink-3`} />;
  return <Check aria-hidden="true" className={`${cls} text-ok`} />;
}

function Chip({ children, tone = 'plain', title, testId }: { children: ReactNode; tone?: 'plain' | 'brand' | 'ok' | 'warn' | 'risk'; title?: string; testId?: string }) {
  const t = {
    plain: 'bg-page text-ink-2',
    brand: 'bg-brand-tint text-brand-deep',
    ok: 'bg-ok-tint text-ok',
    warn: 'bg-warn-tint text-warn',
    risk: 'bg-risk-tint text-risk',
  }[tone];
  return (
    <span title={title} data-testid={testId} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-medium leading-5 ${t}`}>
      {children}
    </span>
  );
}

function scrollToDecision() {
  const el = document.getElementById('decision');
  if (!el) return;
  const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
}

function StepRow({ s, last, current, open, onToggle }: { s: LiveStep; last: boolean; current: boolean; open: boolean; onToggle: () => void }) {
  const chip = autonomyWord(s.autonomy);
  return (
    <m.li
      data-testid="agent-step"
      data-state={s.state}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className="relative pl-10"
    >
      <span aria-hidden="true" className={`absolute top-0 left-[15px] w-px bg-line ${last ? 'h-5' : 'h-full'}`} />
      <span className={`absolute top-[7px] left-0 grid size-[31px] place-items-center rounded-full border ${NODE[s.state]}`}>
        {current ? <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-brand/20 motion-reduce:animate-none" /> : null}
        <s.Icon aria-hidden="true" className="relative size-4" />
      </span>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`my-1 flex w-full cursor-pointer flex-col gap-0.5 rounded-[10px] border-0 px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand ${current ? 'bg-brand-tint' : 'bg-transparent hover:bg-page'}`}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-6 text-ink">{s.short}</span>
          <span className="text-[12px] tabular-nums text-ink-3">{s.tick}</span>
          <StateIcon s={s.state} />
          <span className="sr-only">{STATE_WORD[s.state]}</span>
          <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-ink-3 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
        </span>
        {s.summary ? <span className="truncate text-[14px] leading-5 text-ink-2">{s.summary}</span> : null}
      </button>
      {open ? (
        <div data-testid="agent-step-detail" className="mb-2 ml-3 grid gap-1.5 text-[14px] leading-5 text-ink-2">
          <p className="m-0">{s.summary || s.label}</p>
          <p className="m-0 flex flex-wrap gap-1.5">
            {chip ? <Chip tone={s.autonomy === 'approval' ? 'warn' : s.autonomy === 'never' ? 'risk' : 'plain'}>{chip}</Chip> : null}
            {s.rule ? <Chip>Rule</Chip> : null}
            <Chip tone={s.state === 'rejected' ? 'risk' : s.state === 'approval' ? 'warn' : s.state === 'running' ? 'brand' : 'ok'}>{STATE_WORD[s.state]}</Chip>
          </p>
        </div>
      ) : null}
    </m.li>
  );
}

const PHASE_CHIP: Record<PhaseState, string> = {
  waiting: 'border-line bg-white text-ink-3',
  running: 'border-brand bg-brand-tint text-brand-deep',
  done: 'border-ok-tint bg-ok-tint text-ink',
  approval: 'border-warn bg-warn-tint text-ink',
  guard: 'border-brand-100 bg-brand-tint text-ink',
};
const PHASE_WORD: Record<PhaseState, string> = { waiting: 'Waiting', running: 'Working', done: 'Done', approval: 'Needs approval', guard: 'Guard rail stopped a request' };

function PhaseIcon({ s }: { s: PhaseState }) {
  const cls = 'size-4 shrink-0';
  if (s === 'running') return <LoaderCircle aria-hidden="true" className={`${cls} animate-spin text-brand motion-reduce:animate-none`} />;
  if (s === 'approval') return <Hand aria-hidden="true" className={`${cls} text-warn`} />;
  if (s === 'guard') return <ShieldHalf aria-hidden="true" className={`${cls} text-brand`} />;
  if (s === 'done') return <Check aria-hidden="true" className={`${cls} text-ok`} />;
  return <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-line-2" />;
}

function Pipeline({ phases, open, onOpen, fill }: { phases: Phase[]; open: string | null; onOpen: (k: string | null) => void; fill?: boolean[] }) {
  return (
    <div data-testid="agent-pipeline" className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-0">
      {phases.map((p, i) => {
        const active = p.steps.length > 0;
        const isOpen = open === p.key;
        return (
          <div key={p.key} className="contents sm:flex sm:min-w-0 sm:flex-1 sm:items-center sm:last:flex-none">
            <button
              type="button"
              data-testid="agent-phase"
              data-phase={p.key}
              data-state={p.state}
              aria-expanded={isOpen}
              aria-controls="agent-phase-panel"
              disabled={!active}
              onClick={() => onOpen(isOpen ? null : p.key)}
              className={`relative flex min-w-0 cursor-pointer items-center gap-2 rounded-[10px] border px-3 py-2 text-left text-[14px] font-semibold leading-5 focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-default ${PHASE_CHIP[p.state]} ${isOpen ? 'ring-2 ring-brand' : ''}`}
            >
              {p.state === 'running' ? <span aria-hidden="true" className="absolute inset-0 animate-pulse rounded-[10px] bg-brand/10 motion-reduce:animate-none" /> : null}
              <p.Icon aria-hidden="true" className="relative size-4 shrink-0" />
              <span className="relative min-w-0 flex-1 truncate">{p.name}</span>
              {active ? (
                <span data-testid="agent-phase-count" className="relative rounded-full bg-white px-1.5 text-[12px] font-medium tabular-nums text-ink-2">
                  {p.count}
                </span>
              ) : null}
              <span className="relative">
                <PhaseIcon s={p.state} />
              </span>
              <span className="sr-only">{PHASE_WORD[p.state]}</span>
            </button>
            {i < phases.length - 1 ? (
              <span aria-hidden="true" className="hidden h-0.5 min-w-3 flex-1 overflow-hidden rounded-full bg-line sm:block">
                <span
                  data-testid="agent-link"
                  data-filled={fill ? fill[i + 1] : phases[i + 1].steps.length > 0}
                  className={`block h-full rounded-full bg-brand transition-[width] duration-500 motion-reduce:transition-none ${(fill ? fill[i + 1] : phases[i + 1].steps.length > 0) ? 'w-full' : 'w-0'}`}
                />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PhasePanel({ phase }: { phase: Phase }) {
  return (
    <div id="agent-phase-panel" data-testid="agent-phase-panel" data-phase={phase.key} className="rounded-[10px] bg-page p-2">
      <ul className="m-0 grid list-none gap-1 p-0">
        {phase.steps.map((s) => {
          const chip = autonomyWord(s.autonomy);
          return (
            <li key={s.key} data-testid="phase-step" data-state={s.state} className="flex items-center gap-2 rounded-[10px] bg-white px-3 py-1.5 text-[14px] leading-5">
              <s.Icon aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
              <span className="shrink-0 font-semibold text-ink">
                {s.short}
                {s.n > 1 ? ` x${s.n}` : ''}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-2">{s.summary}</span>
              {chip ? <Chip tone={s.autonomy === 'approval' ? 'warn' : s.autonomy === 'never' ? 'risk' : 'plain'}>{chip}</Chip> : null}
              <StateIcon s={s.state} />
              <span className="sr-only">{STATE_WORD[s.state]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const trim = (t: string, n = 90) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);

export function AgentLive({ d, o, autoStart = true }: { d: Detail; o: Overview; autoStart?: boolean }) {
  const { busy, runAgent } = useLaunch();
  const agent = o.agent || {};
  const running = !!agent.running;
  const working = running || busy;
  const err = !working && !!agent.error;

  /* ---- steps: streamed while running, trace once it arrives (streamed rows stay until then, no flicker) ---- */
  const traceFp = JSON.stringify(d.trace || []);
  const baseFp = useRef(traceFp);
  const ran = useRef(false);
  const prevWorking = useRef(false);
  useEffect(() => {
    if (working && !prevWorking.current) {
      baseFp.current = traceFp;
      ran.current = true;
    }
    prevWorking.current = working;
  }, [working, traceFp]);

  const fromTrace = traceSteps(railRows(d));
  const fromStream = streamSteps(agent.steps, running);
  const useStream = working || (ran.current && traceFp === baseFp.current) || fromTrace.length === 0;
  const steps = useStream ? fromStream : fromTrace;

  /* ---- auto start: once per case + evidence, after one second, cancellable ---- */
  const key = autoStartKey(d);
  const eligible = autoStart && !busy && shouldAutoStart(d, o, startedKeys());
  const [skipped, setSkipped] = useState<string | null>(null);
  const starting = eligible && skipped !== key;
  useEffect(() => {
    if (!starting) return;
    const t = window.setTimeout(() => {
      markStarted(key);
      void runAgent();
    }, AUTO_START_MS);
    return () => window.clearTimeout(t);
  }, [starting, key, runAgent]);

  /* ---- elapsed ---- */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    setElapsed(0);
    const i = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(i);
  }, [running]);

  /* ---- expand one step ---- */
  const [open, setOpen] = useState<string | null>(null);
  const [openPhase, setOpenPhase] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const realPhases = groupPhases(steps);
  /* guided demo only: replay the pipeline filling left to right over the scene; real data, nothing is called */
  const replay = useDemoReplay('agent');
  const activeIdx = realPhases.map((p, n) => (p.steps.length ? n : -1)).filter((n) => n >= 0);
  const replaying = replay != null && activeIdx.length > 0;
  const lit = replaying ? Math.min(activeIdx.length, Math.floor((replay / 0.9) * activeIdx.length) + 1) : 0;
  const litSet = new Set(activeIdx.slice(0, lit));
  const curIdx = replaying && replay < 0.9 ? activeIdx[lit - 1] : -1;
  const phases: Phase[] = replaying ? realPhases.map((p, n) => (!p.steps.length ? p : !litSet.has(n) ? { ...p, state: 'waiting' } : n === curIdx ? { ...p, state: 'running' } : p)) : realPhases;
  const replayFill = replaying ? realPhases.map((p, n) => litSet.has(n) && p.steps.length > 0) : undefined;
  const replayNow = replaying && curIdx >= 0 ? `${realPhases[curIdx].name}…` : '';
  const openedPhase = phases.find((p) => p.key === openPhase && p.steps.length > 0) || null;
  useEffect(() => {
    if (!openPhase) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPhase(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openPhase]);

  /* ---- polite announcement, debounced so a burst of steps is one message ---- */
  const [said, setSaid] = useState('');
  const seen = useRef(steps.length);
  useEffect(() => {
    if (steps.length === seen.current) return;
    seen.current = steps.length;
    const done = [...steps].reverse().find((s) => s.state !== 'running');
    if (!done) return;
    const t = window.setTimeout(() => setSaid(`Step done: ${done.short}`), 800);
    return () => window.clearTimeout(t);
  }, [steps]);

  /* ---- header numbers ---- */
  const mode = modeBadge(d.run_mode);
  const hasResult = !!d.run_mode || (!working && fromTrace.length > 0);
  const calls = working ? steps.length : (d.agent?.tool_calls ?? agent.tool_calls ?? 0);
  const blocked = working ? 0 : (d.agent?.rejected ?? 0);
  const secs = working ? elapsed : (d.agent?.seconds ?? agent.seconds ?? null);
  const typical = d.agent?.tool_calls || fromTrace.length || 0;
  const needsYou = !working && !!d.brief && !d.case?.sent_at && !d.offer && approvalsNeeded(d) > 0;
  const aiOff = (o.integrations?.ai_enabled ?? d.integrations?.ai_enabled) === false;
  const status: { text: string; tone: 'plain' | 'brand' | 'ok' | 'warn' | 'risk' } = err
    ? { text: 'Error', tone: 'risk' }
    : working
      ? { text: 'Working', tone: 'brand' }
      : starting
        ? { text: 'Starting', tone: 'brand' }
        : needsYou
          ? { text: 'Needs you', tone: 'warn' }
          : hasResult
            ? { text: 'Done', tone: 'ok' }
            : aiOff
              ? { text: 'Offline rules', tone: 'plain' }
              : { text: 'Idle', tone: 'plain' };

  const headline = d.brief?.headline || cardTitle(d.brief?.recommendation) || '';
  const showVerdict = !working && hasResult && steps.length > 0;
  const lastKey = steps[steps.length - 1]?.key;
  const nowLabel = steps[steps.length - 1]?.raw;
  const compact = showVerdict && !openedPhase && !showAll;  const pct = working && typical > 0 ? Math.min(95, Math.round((steps.length / typical) * 100)) : null;

  return (
    <section
      id="agent"
      data-demo="agent"
      data-testid="agent-live"
      aria-label="Launch agent"
      data-compact={compact}
      className={`grid gap-4 rounded-[16px] bg-card p-4 shadow-card sm:p-6 ${compact ? 'agent-compact sm:max-h-[260px]' : ''}`}
    >
      <header className="grid gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-brand-tint text-brand">
            <Bot aria-hidden="true" className="size-5" />
          </span>
          <h2 className="m-0 min-w-0 flex-1 text-[18px] font-semibold leading-6 text-ink">Launch agent</h2>
          <Chip tone={status.tone} testId="agent-status">
            {working ? <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-brand motion-reduce:animate-none" /> : null}
            {status.text}
          </Chip>
          <button
            type="button"
            aria-label={hasResult ? 'Run again' : 'Run agent'}
            title={hasResult ? 'Run again' : 'Run agent'}
            disabled={working}
            onClick={() => void runAgent()}
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-[10px] border border-line bg-white text-ink-2 hover:bg-page focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-default disabled:opacity-50"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2" data-testid="agent-chips">
          {mode ? (
            <Chip tone={mode.short === 'Model' ? 'brand' : 'plain'} title={mode.text} testId="agent-mode">
              {mode.text}
            </Chip>
          ) : null}
          {calls > 0 ? <Chip testId="agent-calls">{callsText(calls)}</Chip> : null}
          {blocked > 0 ? (
            <Chip tone="ok" title="Guard rails stopped requests the agent is not allowed to make" testId="agent-blocked">
              <ShieldHalf aria-hidden="true" className="size-3.5" />
              {blockedText(blocked)}
            </Chip>
          ) : null}
          {secs != null && (working || hasResult) ? (
            <Chip testId="agent-seconds">
              <Timer aria-hidden="true" className="size-3.5" />
              {secs}s
            </Chip>
          ) : null}
        </div>

        {working || starting ? (
          <div className="flex items-center gap-3">
            <div
              role="progressbar"
              aria-label={starting ? 'Starting' : 'Agent progress'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={starting ? undefined : (pct ?? undefined)}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-100"
            >
              {starting ? (
                <m.div className="h-full origin-left rounded-full bg-brand" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: AUTO_START_MS / 1000, ease: 'linear' }} />
              ) : pct != null ? (
                <div className="h-full rounded-full bg-brand transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
              ) : (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-brand motion-reduce:animate-none" />
              )}
            </div>
            <span className="shrink-0 text-[13px] tabular-nums text-ink-2" data-testid="agent-count">
              {starting ? 'Starting' : typical > steps.length ? `${steps.length} of ~${typical}` : `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`}
            </span>
            {starting ? (
              <button
                type="button"
                onClick={() => {
                  markStarted(key);
                  setSkipped(key);
                }}
                className="shrink-0 cursor-pointer rounded-[10px] border border-line bg-white px-3 py-1 text-[13px] font-medium text-ink-2 hover:bg-page focus-visible:outline-2 focus-visible:outline-brand"
              >
                Skip
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {err ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] bg-risk-tint px-3 py-2 text-[14px] text-risk">
          <CircleX aria-hidden="true" className="size-4 shrink-0" />
          <span className="flex-1">Run stopped. Nothing was sent.</span>
          <button
            type="button"
            onClick={() => void runAgent()}
            className="cursor-pointer rounded-[10px] border border-risk bg-white px-3 py-1 text-[13px] font-medium text-risk focus-visible:outline-2 focus-visible:outline-risk"
          >
            Retry
          </button>
        </div>
      ) : null}

      {steps.length ? (
        <div className="grid gap-3">
          <Pipeline phases={phases} open={openedPhase?.key ?? null} onOpen={setOpenPhase} fill={replayFill} />

          {replayNow ? (
            <p data-testid="agent-now" data-demo-replay="" className="m-0 flex items-center gap-1 text-[15px] font-semibold leading-6 text-ink">
              <m.span key={replayNow} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                {replayNow}
              </m.span>
              <span aria-hidden="true" className="inline-block h-4 w-0.5 animate-pulse bg-brand motion-reduce:animate-none" />
            </p>
          ) : null}

          {working && nowLabel ? (
            <p data-testid="agent-now" className="m-0 flex items-center gap-1 text-[15px] font-semibold leading-6 text-ink">
              <m.span key={nowLabel} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                {nowText(nowLabel)}
              </m.span>
              <span aria-hidden="true" className="inline-block h-4 w-0.5 animate-pulse bg-brand motion-reduce:animate-none" />
            </p>
          ) : null}

          {openedPhase ? <PhasePanel phase={openedPhase} /> : null}

          {showVerdict ? (
            <div
              data-testid="agent-verdict"
              className={`flex flex-wrap items-center gap-2 rounded-[10px] px-3 py-2 ${needsYou ? 'bg-warn-tint' : 'bg-ok-tint'}`}
            >
              {needsYou ? <Hand aria-hidden="true" className="size-4 shrink-0 text-warn" /> : <Check aria-hidden="true" className="size-4 shrink-0 text-ok" />}
              <p className="m-0 min-w-0 flex-1 text-[15px] font-semibold leading-6 text-ink">{headline ? trim(headline) : needsYou ? 'Ready for your decision' : 'Done'}</p>
              {needsYou ? (
                <button
                  type="button"
                  onClick={scrollToDecision}
                  className="cursor-pointer rounded-[10px] border-0 bg-warn px-3 py-1.5 text-[14px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warn"
                >
                  Needs your approval
                </button>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll(!showAll)}
            className="inline-flex w-fit cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[13px] font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {showAll ? 'Hide steps' : 'Show all steps'}
            <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform motion-reduce:transition-none ${showAll ? 'rotate-180' : ''}`} />
          </button>

          {showAll ? (
            <ol className="m-0 list-none p-0" data-testid="agent-steps">
              <AnimatePresence initial={false}>
                {steps.map((s, i) => (
                  <StepRow
                    key={s.key}
                    s={s}
                    last={i === steps.length - 1}
                    current={working && s.key === lastKey}
                    open={open === s.key}
                    onToggle={() => setOpen(open === s.key ? null : s.key)}
                  />
                ))}
              </AnimatePresence>
            </ol>
          ) : null}
        </div>
      ) : !err && !starting && !working ? (
        <p className="m-0 text-[14px] text-ink-3" data-testid="agent-empty">
          Not run yet.
        </p>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite" data-testid="agent-announce">
        {said}
      </p>
    </section>
  );
}
