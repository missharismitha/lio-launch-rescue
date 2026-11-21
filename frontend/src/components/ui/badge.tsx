import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const badgeVariants = cva('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] leading-[18px] font-medium whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-warn-wash text-ink',
      ok: 'bg-ok-wash text-ok',
      risk: 'bg-risk-wash text-risk',
      warn: 'bg-warn-wash text-warn',
      accent: 'bg-accent-wash text-accent-ink',
      unknown: 'hatch border border-line-2 bg-card text-ink-2',
      dark: 'bg-white/10 text-band-fg',
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
export const Unknown = () => <Badge tone="unknown">unknown</Badge>;
