import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/* No box: sections are separated by hairlines and space, never by borders around them. */
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn(className)} {...props} />;
}
