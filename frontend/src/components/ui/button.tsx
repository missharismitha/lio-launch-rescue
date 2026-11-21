import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap select-none transition-[background-color,transform,opacity] duration-160 active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0',
  {
    variants: {
      variant: {
        primary: 'bg-ink text-white hover:bg-ink-hover',
        secondary: 'border border-line-2 bg-white text-ink hover:bg-line/50',
        ghost: 'text-ink hover:bg-line/60',
        link: 'text-ink underline underline-offset-4 hover:text-ink-2',
      },
      size: {
        md: 'min-h-11 px-5 text-[15px]',
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
