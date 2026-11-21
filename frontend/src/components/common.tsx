import { UserCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Unknown } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { eur } from '@/lib/format';
import type { Approver } from '@/lib/types';

export function ApproverBadge({ a }: { a?: Approver | null }) {
  if (!a || !a.role) return <Unknown />;
  if (a.vacancy)
    return (
      <Badge tone="warn">
        <UserCheck className="size-3.5" aria-hidden="true" />
        {a.role}, seat vacant
      </Badge>
    );
  if (a.provisional)
    return (
      <Badge tone="neutral" title="Cost is unknown, so this is the lowest approver that could apply.">
        <UserCheck className="size-3.5" aria-hidden="true" />
        {a.name || a.role}, provisional
      </Badge>
    );
  return (
    <Badge tone="neutral">
      <UserCheck className="size-3.5" aria-hidden="true" />
      {a.name || a.role}
    </Badge>
  );
}

export const Money = ({ v }: { v?: number | null }) => (v != null ? <span className="num">{eur(v)}</span> : <Unknown />);

export function Overline({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[11px] leading-4 font-semibold tracking-[0.08em] uppercase', className)}>{children}</p>;
}

export function Facts({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2', className)}>{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[13px] leading-[18px] text-ink-2">{label}</dt>
      <dd className="m-0 font-semibold">{children}</dd>
    </>
  );
}

export function SheetSection({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="grid gap-3 rounded-card border border-line bg-card p-4">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}
