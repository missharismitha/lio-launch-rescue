import { animate } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { num } from '@/lib/format';

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* Magic UI style NumberTicker on motion: tweens only when the value changes; reduced motion jumps to the final value. */
export function NumberTicker({ value, format = num, className, testId }: { value: number; format?: (v: number) => string; className?: string; testId?: string }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value || reduced()) {
      setShown(value);
      return;
    }
    const c = animate(from, value, { duration: 0.6, ease: [0.2, 0.7, 0.2, 1], onUpdate: (v) => setShown(v) });
    return () => c.stop();
  }, [value]);

  return (
    <span className={className} data-testid={testId} aria-label={format(value)}>
      <span aria-hidden="true">{format(shown)}</span>
    </span>
  );
}
