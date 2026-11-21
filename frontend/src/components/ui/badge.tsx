import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/* Status is plain words. Colour only on small text and markers: risk and ok. No filled pills. */
const badgeVariants = cva('inline-flex items-center gap-1.5 text-[14px] leading-5 whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'text-ink-2',
      ok: 'text-ok',
      risk: 'text-risk',
      warn: 'text-ink-2',
      accent: 'text-ink',
      tag: 'rounded-md border border-line-2 px-2 text-ink-2',
      unknown: 'unknown',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export const Dot = ({ className }: { className?: string }) => <i aria-hidden="true" className={cn('inline-block size-1.5 rounded-full bg-current', className)} />;

/* unknown is shown, never hidden or guessed */
export const Unknown = () => <span className="unknown">unknown</span>;
