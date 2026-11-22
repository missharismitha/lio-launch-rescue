import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, TriangleAlert, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUi, type TabId } from '@/hooks/useUi';
import manifest from '@/lib/demoManifest.json';
import { shortLines } from '@/lib/derive';
import type { Detail } from '@/lib/types';

/* Guided demo with an AI voice-over. One audio file per scene (public/audio/demo), captions from the
   manifest (the recorded words). It only scrolls, highlights and replays what is already on the page:
   it never approves, sends, saves or starts anything. */

export interface DemoScene {
  id: string;
  selector: string;
  sheetTab: string | null;
  caption: string;
  text: string;
  file: string;
  ms: number;
}
export const SCENES = manifest.scenes as DemoScene[];
export const GAP_MS = 350;
export const MAX_TOTAL_MS = 125000;

/* every scene plays in full, with a short pause between scenes (n - 1 gaps) */
export const demoTotalMs = (scenes: readonly { ms: number }[] = SCENES): number =>
  scenes.reduce((s, x) => s + x.ms, 0) + Math.max(0, scenes.length - 1) * GAP_MS;

/* 'about 2 minutes' / 'about 1 min 50 s', rounded to 10 s, computed from the manifest */
export function aboutText(ms: number): string {
  const total = Math.round(ms / 10000) * 10;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (s === 0) return `about ${m} ${m === 1 ? 'minute' : 'minutes'}`;
  return `about ${m ? `${m} min ` : ''}${s} s`;
}

export const clockText = (ms: number): string => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/* The facts the voice-over was recorded against (the dataset of the recording).
   If the live data differs, the screen is flagged, playback is never blocked. */
export const NARRATED_FACTS = { short: 6800, hold: 36000 };

export function narratedMismatch(d: Detail): boolean {
  const lines = shortLines(d);
  const short = lines.length ? lines.reduce((s, l) => s + (l.short || 0), 0) : d.shortage;
  const hold = (d.holds || []).find((h) => typeof h.quantity === 'number')?.quantity;
  return short !== NARRATED_FACTS.short || hold !== NARRATED_FACTS.hold;
}
const MISMATCH_NOTE = 'Voice-over was recorded for the earlier data; numbers on screen may differ.';

const visible = (sel: string): HTMLElement | null => {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
};
const calm = () => typeof window.matchMedia === 'function' && !!window.matchMedia('(prefers-reduced-motion: reduce)')?.matches;

type Phase = 'start' | 'play' | 'end';

export function DemoOverlay({ d }: { d: Detail; o?: unknown }) {
  const ui = useUi();
  const { openSheet, closeSheet, setDemoOpen, setDemoScene, setDemoPlaying } = ui;
  const open = ui.demoOpen;
  const [phase, setPhase] = useState<Phase>('start');
  const [i, setI] = useState(0);
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captionsOnly, setCaptionsOnly] = useState(false);
  const [fail, setFail] = useState(false);
  const [sceneMs, setSceneMs] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const mismatch = useMemo(() => narratedMismatch(d), [d]);
  const total = useMemo(() => demoTotalMs(), []);
  const scene = SCENES[i];

  const audios = useRef(new Map<number, HTMLAudioElement>());
  const gapT = useRef<number | null>(null);
  const sceneDone = useRef(false);
  const fallbackMs = useRef(0);
  const iRef = useRef(0);
  const pausedRef = useRef(false);
  const failRef = useRef(false);
  const mutedRef = useRef(false);
  const prevPaused = useRef(false);
  iRef.current = i;
  pausedRef.current = paused;
  failRef.current = fail;
  mutedRef.current = muted;

  const clearGap = () => {
    if (gapT.current != null) window.clearTimeout(gapT.current);
    gapT.current = null;
  };
  const getAudio = (idx: number): HTMLAudioElement | null => {
    const sc = SCENES[idx];
    if (!sc || typeof Audio === 'undefined') return null;
    let a = audios.current.get(idx);
    if (!a) {
      a = new Audio(sc.file);
      a.preload = 'auto';
      audios.current.set(idx, a);
    }
    a.muted = mutedRef.current;
    return a;
  };
  const stopAudio = useCallback(() => {
    if (gapT.current != null) window.clearTimeout(gapT.current);
    gapT.current = null;
    audios.current.forEach((a) => {
      try {
        a.pause();
      } catch {
        /* ignore */
      }
    });
    audios.current.clear();
  }, []);

  const close = useCallback(() => {
    stopAudio();
    setDemoScene(null);
    setDemoPlaying(false);
    setDemoOpen(false);
    closeSheet();
  }, [stopAudio, setDemoScene, setDemoPlaying, setDemoOpen, closeSheet]);

  const goTo = useCallback((idx: number) => {
    if (gapT.current != null) window.clearTimeout(gapT.current);
    gapT.current = null;
    audios.current.get(iRef.current)?.pause();
    setPaused(false);
    if (idx >= SCENES.length) {
      setPhase('end');
      setDemoScene(null);
      setDemoPlaying(false);
      return;
    }
    const n = Math.max(0, idx);
    setPhase('play');
    setI(n);
    setRun((r) => r + 1);
  }, [setDemoScene, setDemoPlaying]);

  const scheduleAdvance = useCallback(() => {
    if (gapT.current != null) window.clearTimeout(gapT.current);
    gapT.current = window.setTimeout(() => {
      gapT.current = null;
      goTo(iRef.current + 1);
    }, GAP_MS);
  }, [goTo]);

  const finish = useCallback(() => {
    if (sceneDone.current) return;
    sceneDone.current = true;
    setSceneMs(SCENES[iRef.current]?.ms ?? 0);
    if (!pausedRef.current) scheduleAdvance();
  }, [scheduleAdvance]);

  /* reset when the demo opens */
  useEffect(() => {
    if (!open) return;
    setPhase('start');
    setI(0);
    setPaused(false);
    setFail(false);
    setSceneMs(0);
    setCaptionsOnly(false);
    return () => stopAudio();
  }, [open, stopAudio]);

  const begin = (silent: boolean) => {
    setCaptionsOnly(silent);
    setPaused(false);
    setI(0);
    setRun((r) => r + 1);
    setPhase('play');
  };

  /* a scene starts: audio, spotlight target, replay id */
  useEffect(() => {
    if (!open || phase !== 'play' || !scene) return;
    sceneDone.current = false;
    fallbackMs.current = 0;
    prevPaused.current = false;
    setSceneMs(0);
    setFail(false);
    failRef.current = false;
    setDemoScene(scene.id);

    const el0 = visible(scene.selector);
    if (!el0 && scene.sheetTab) openSheet(scene.sheetTab as TabId, 'details');
    else closeSheet();

    let first = true;
    const measure = () => {
      const el = visible(scene.selector);
      if (el && first) {
        first = false;
        el.scrollIntoView?.({ block: 'center', behavior: calm() ? 'auto' : 'smooth' });
      }
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const t0 = window.setTimeout(measure, 60);
    const t1 = window.setInterval(measure, 300);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });

    let audio: HTMLAudioElement | null = null;
    const onEnded = () => finish();
    const onErr = () => setFail(true);
    if (!captionsOnly) {
      audio = getAudio(i);
      if (audio) {
        try {
          audio.currentTime = 0;
        } catch {
          /* ignore */
        }
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('error', onErr);
        try {
          const p = audio.play();
          if (p && typeof p.catch === 'function') p.catch(() => setFail(true));
        } catch {
          setFail(true);
        }
        getAudio(i + 1);
      } else {
        setFail(true);
      }
    }
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(t1);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
      if (audio) {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onErr);
        audio.pause();
      }
      if (gapT.current != null) window.clearTimeout(gapT.current);
      gapT.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase, i, run, captionsOnly]);

  /* pause / resume: audio, gap timer, clock and replay together */
  useEffect(() => {
    setDemoPlaying(open && phase === 'play' && !paused);
    if (!open || phase !== 'play' || prevPaused.current === paused) return;
    prevPaused.current = paused;
    const a = audios.current.get(iRef.current);
    if (paused) {
      a?.pause();
      if (gapT.current != null) window.clearTimeout(gapT.current);
      gapT.current = null;
    } else if (sceneDone.current) {
      scheduleAdvance();
    } else if (a && !captionsOnly && !failRef.current) {
      try {
        const p = a.play();
        if (p && typeof p.catch === 'function') p.catch(() => setFail(true));
      } catch {
        setFail(true);
      }
    }
  }, [paused, open, phase, captionsOnly, scheduleAdvance, setDemoPlaying]);

  useEffect(() => {
    audios.current.forEach((a) => {
      a.muted = muted;
    });
  }, [muted]);

  /* clock: audio.currentTime when it is playing, otherwise a timer (also the stall guard) */
  useEffect(() => {
    if (!open || phase !== 'play' || paused) return;
    const t = window.setInterval(() => {
      if (sceneDone.current) return;
      const sc = SCENES[iRef.current];
      if (!sc) return;
      fallbackMs.current += 250;
      const a = audios.current.get(iRef.current);
      const ct = a && !failRef.current ? (a.currentTime || 0) * 1000 : 0;
      setSceneMs(Math.min(sc.ms, ct > 0 ? ct : fallbackMs.current));
      const timerOnly = captionsOnly || failRef.current;
      if ((timerOnly && fallbackMs.current >= sc.ms) || fallbackMs.current >= sc.ms + 4000) finish();
    }, 250);
    return () => window.clearInterval(t);
  }, [open, phase, paused, i, run, captionsOnly, finish]);

  /* keyboard */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || phase !== 'play') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === ' ') {
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        setPaused((v) => !v);
      } else if (e.key === 'ArrowRight') goTo(iRef.current + 1);
      else if (e.key === 'ArrowLeft') goTo(iRef.current - 1);
      else if (e.key === 'm' || e.key === 'M') setMuted((v) => !v);
      else if (e.key === 'r' || e.key === 'R') goTo(0);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, phase, close, goTo]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  if (!open) return null;

  const pad = 6;
  const instant = calm();
  const elapsed = SCENES.slice(0, i).reduce((s, x) => s + x.ms + GAP_MS, 0) + sceneMs;
  const shown = phase === 'end' ? total : Math.min(total, elapsed);
  const spot = rect && phase === 'play' ? (
    <div
      aria-hidden="true"
      data-testid="demo-spot"
      className={`pointer-events-none fixed z-[70] rounded-card ring-2 ring-white ${instant ? '' : 'transition-[top,left,width,height] duration-200'}`}
      style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: '0 0 0 9999px rgba(11,31,92,.6)' }}
    />
  ) : null;
  const shell = 'fixed inset-x-0 bottom-0 z-[71] mx-auto grid max-w-none gap-3 rounded-t-card border border-line bg-white p-4 shadow-sheet sm:inset-x-auto sm:right-6 sm:bottom-3 sm:max-w-md sm:rounded-card';
  const note = mismatch ? (
    <p data-testid="demo-mismatch" className="m-0 flex items-start gap-2 rounded-control bg-warn-tint px-3 py-2 text-[13px] leading-5 text-warn">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {MISMATCH_NOTE}
    </p>
  ) : null;

  if (phase === 'start') {
    return (
      <div data-demo-ui="" className="print:hidden">
        <div role="dialog" aria-label="Guided demo" data-testid="demo-card" style={{ pointerEvents: 'auto' }} className={shell}>
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-0.5">
              <h2 className="m-0 text-[18px] leading-6 font-semibold text-ink">Play demo with voice-over</h2>
              <p className="m-0 text-[14px] text-ink-2" data-testid="demo-length">{aboutText(total)}</p>
            </div>
            <Button size="icon" variant="ghost" aria-label="Close demo" data-testid="demo-esc" onClick={close}>
              <X className="size-5" aria-hidden="true" />
            </Button>
          </div>
          {note}
          <Button size="md" data-testid="demo-play" autoFocus className="w-full" onClick={() => begin(false)}>
            <Play className="size-5" aria-hidden="true" />
            Play
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 inline-flex items-center gap-1.5 text-[13px] text-ink-3">
              <Volume2 className="size-4" aria-hidden="true" />
              Sound on
            </p>
            <Button size="sm" variant="secondary" data-testid="demo-captions" onClick={() => begin(true)}>
              Captions only
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'end') {
    return (
      <div data-demo-ui="" className="print:hidden">
        <div role="dialog" aria-label="Guided demo" data-testid="demo-card" style={{ pointerEvents: 'auto' }} className={shell}>
          <h2 className="m-0 text-[18px] leading-6 font-semibold text-ink" data-testid="demo-end">That was the demo</h2>
          <p className="m-0 text-[14px] text-ink-2">Nothing was approved or sent.</p>
          {note}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" data-testid="demo-replay" onClick={() => goTo(0)}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Replay
            </Button>
            <Button size="sm" variant="secondary" data-testid="demo-esc" onClick={close}>
              Close
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const silent = captionsOnly || fail;
  return (
    <div data-demo-ui="" className="print:hidden">
      {spot}
      <div role="dialog" aria-label="Guided demo" data-testid="demo-card" style={{ pointerEvents: 'auto' }} className={shell}>
        <div className="flex items-center justify-between gap-3 text-[14px] text-ink-2">
          <span className="font-semibold text-ink" data-testid="demo-caption">{scene.caption}</span>
          <span className="num" data-testid="demo-clock">{clockText(shown)} / {clockText(total)}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={Math.round(total / 1000)} aria-valuenow={Math.round(shown / 1000)} aria-label="Demo progress">
          <div className="h-full bg-brand" style={{ width: `${(shown / total) * 100}%` }} />
        </div>
        <p className="m-0 min-h-[4.5rem] text-[15px] leading-6 text-ink" aria-live="polite" data-testid="demo-text">
          {scene.text}
        </p>
        {captionsOnly || !fail ? null : (
          <p data-testid="demo-voice-fail" className="m-0 text-[13px] text-warn">
            Voice unavailable, captions only
          </p>
        )}
        {note}
        <div className="flex items-center justify-center gap-0.5" role="group" aria-label="Scenes">
          {SCENES.map((s, n) => (
            <button
              key={s.id}
              type="button"
              data-testid="demo-dot"
              aria-label={`Scene ${n + 1}: ${s.caption}`}
              aria-current={n === i ? 'step' : undefined}
              onClick={() => goTo(n)}
              className="grid size-6 cursor-pointer place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-brand"
            >
              <span className={`block rounded-full ${n === i ? 'size-3 bg-brand' : n < i ? 'size-2 bg-brand/50' : 'size-2 bg-line-2'}`} />
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="icon" variant="secondary" aria-label="Back" data-testid="demo-back" disabled={i === 0} onClick={() => goTo(i - 1)}>
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Button>
          <Button size="icon" aria-label={paused ? 'Play' : 'Pause'} data-testid="demo-pause" onClick={() => setPaused((v) => !v)}>
            {paused ? <Play className="size-5" aria-hidden="true" /> : <Pause className="size-5" aria-hidden="true" />}
          </Button>
          <Button size="icon" variant="secondary" aria-label="Next" data-testid="demo-next" onClick={() => goTo(i + 1)}>
            <ChevronRight className="size-5" aria-hidden="true" />
          </Button>
          <Button size="icon" variant="ghost" aria-label={muted ? 'Unmute' : 'Mute'} data-testid="demo-mute" disabled={silent && captionsOnly} onClick={() => setMuted((v) => !v)}>
            {muted ? <VolumeX className="size-5" aria-hidden="true" /> : <Volume2 className="size-5" aria-hidden="true" />}
          </Button>
          <Button size="icon" variant="ghost" aria-label="Restart" data-testid="demo-restart" onClick={() => goTo(0)}>
            <RotateCcw className="size-5" aria-hidden="true" />
          </Button>
          <Button size="sm" variant="ghost" data-testid="demo-esc" className="ml-auto" onClick={close}>
            <X className="size-4" aria-hidden="true" />
            Close (Esc)
          </Button>
        </div>
      </div>
    </div>
  );
}

export function useDemoShortcut(start: () => void, active: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'g' || e.ctrlKey || e.metaKey || e.altKey || active) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start, active]);
}
