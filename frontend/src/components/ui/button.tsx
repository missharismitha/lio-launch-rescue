import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap select-none transition-[background-color,transform,opacity] duration-120 active:translate-y-px disabled:opacity-55 disabled:active:translate-y-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-band hover:brightness-105',
        secondary: 'border border-line-2 bg-card text-ink hover:bg-page',
        ghost: 'text-ink hover:bg-warn-wash',
        dark: 'border border-white/25 text-band-fg hover:bg-white/10',
        link: 'text-accent-ink underline-offset-4 hover:underline',
      },
      size: {
        md: 'min-h-11 px-4 text-[15px]',
        sm: 'min-h-10 px-3 text-[14px]',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
