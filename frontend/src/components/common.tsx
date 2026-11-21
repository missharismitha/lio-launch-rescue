import type { ReactNode } from 'react';
import { Unknown } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { approverLabel } from '@/lib/derive';
import { eur } from '@/lib/format';
import type { Approver } from '@/lib/types';

/* The approver is a name in ink: no pill, no icon. */
export function ApproverBadge({ a }: { a?: Approver | null }) {
  if (!a || !a.role) return <Unknown />;
  return (
    <span className="text-ink" title={a.provisional ? 'Cost is unknown, so this is the lowest approver that could apply.' : undefined}>
      {approverLabel(a)}
    </span>
  );
}

export const Money = ({ v }: { v?: number | null }) => (v != null ? <span className="num">{eur(v)}</span> : <Unknown />);

export function Facts({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('m-0 grid grid-cols-[minmax(96px,auto)_1fr] items-baseline gap-x-6 gap-y-2', className)}>{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[14px] leading-5 text-ink-2">{label}</dt>
      <dd className="m-0 text-ink">{children}</dd>
    </>
  );
}

/* sections are separated by a hairline and space, never boxed */
export function SheetSection({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="grid gap-3 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h3 className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">{title}</h3>
      {children}
    </section>
  );
}

/* small ink-2 sentence-case label */
export const Label = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn('m-0 text-[14px] leading-5 text-ink-2', className)}>{children}</p>
);

/* 2 px risk rule: the one place status colour is a line */
export const RiskNote = ({ children, testId }: { children: ReactNode; testId?: string }) => (
  <p data-testid={testId} role={testId ? 'status' : undefined} className="m-0 border-l-2 border-risk pl-3 text-ink-2">
    {children}
  </p>
);
