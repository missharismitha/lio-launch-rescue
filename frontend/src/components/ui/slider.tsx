import { Slider as SliderPrimitive } from 'radix-ui';
import type { KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

interface Props {
  id?: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  label: string;
  valueText?: string;
  describedBy?: string;
  pageStep?: number;
  testId?: string;
}

export function Slider({ id, value, min = 0, max = 72, onChange, label, valueText, describedBy, pageStep = 6, testId }: Props) {
  /* PageUp/PageDown move 6 h (Radix default is 10 steps). Arrows, Home and End are Radix. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      onChange(Math.max(min, Math.min(max, value + (e.key === 'PageUp' ? pageStep : -pageStep))));
    }
  };
  return (
    <SliderPrimitive.Root
      className="relative flex h-11 w-full touch-none items-center select-none"
      min={min}
      max={max}
      step={1}
      value={[value]}
      onValueChange={(v) => onChange(v[0] ?? value)}
      onKeyDown={onKeyDown}
    >
      <SliderPrimitive.Track className="relative h-1.5 grow rounded-full bg-line">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent-ink" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        id={id}
        data-testid={testId}
        aria-label={label}
        aria-valuetext={valueText}
        aria-describedby={describedBy}
        className={cn('block size-6 rounded-full border-2 border-accent-ink bg-white shadow-card transition-transform duration-120 hover:scale-110')}
      />
    </SliderPrimitive.Root>
  );
}
