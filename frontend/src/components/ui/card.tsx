import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/* The one card: white, 16 px radius, hairline, soft shadow. */
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('card p-5 sm:p-6', className)} {...props} />;
}
