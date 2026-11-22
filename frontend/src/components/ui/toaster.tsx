import { useEffect, useRef, useState } from 'react';

type Listener = (text: string) => void;
const listeners = new Set<Listener>();

/* Custom toast (no Sonner: it injects a runtime <style>). One message, 5 s, paused on hover or focus. */
export function toast(text: string) {
  for (const l of listeners) l(text);
}

export function Toaster() {
  const [text, setText] = useState('');
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    const l: Listener = (t) => {
      setText(t);
      setTick((n) => n + 1);
    };
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  useEffect(() => {
    if (!text || paused) return;
    const t = window.setTimeout(() => setText(''), 5000);
    return () => window.clearTimeout(t);
  }, [text, tick, paused]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4 print:hidden"
      role="status"
      aria-live="polite"
      data-testid="toast"
    >
      {text ? (
        <div
          key={tick}
          tabIndex={0}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          className="anim-toast pointer-events-auto max-w-md rounded-control bg-brand-navy px-4 py-3 shadow-sheet text-[14px] text-white"
        >
          {text}
        </div>
      ) : null}
    </div>
  );
}
