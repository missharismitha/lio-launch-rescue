import { cva, type VariantProps } from 'class-variance-authority';
import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/* Status is a tinted chip: colour plus an icon or a word, never colour alone. */
const badgeVariants = cva('inline-flex items-center gap-1.5 rounded-full px-2.5 text-[13px] leading-6 font-medium whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-line/60 text-ink-2',
      ok: 'bg-ok-tint text-ok',
      risk: 'bg-risk-tint text-risk',
      warn: 'bg-warn-tint text-warn',
      accent: 'bg-accent-tint text-accent',
      brand: 'bg-brand-tint text-brand',
      tag: 'rounded-md border border-line-2 bg-white px-2 text-ink-2',
      unknown: 'unknown px-0',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export const Dot = ({ className }: { className?: string }) => <i aria-hidden="true" className={cn('inline-block size-1.5 rounded-full bg-current', className)} />;

/* a chip that always carries its icon and its word */
export function StatusChip({ tone, children, className }: { tone: 'ok' | 'warn' | 'risk'; children: ReactNode; className?: string }) {
  const Icon = tone === 'ok' ? CircleCheck : tone === 'risk' ? OctagonAlert : TriangleAlert;
  return (
    <Badge tone={tone} className={className}>
      <Icon className="size-3.5" aria-hidden="true" />
      {children}
    </Badge>
  );
}

/* unknown is shown, never hidden or guessed */
export const Unknown = () => <span className="unknown">unknown</span>;
