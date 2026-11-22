import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  returnFocusId?: string;
  className?: string;
  /* false while the guided demo plays: no focus trap, no dimmed page, the player stays usable */
  modal?: boolean;
}

/* Radix Dialog as a right-hand sheet: focus trapped, Esc closes, focus returns to the opener. */
export function Sheet({ open, onOpenChange, title, children, footer, returnFocusId, className, modal = true }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-40 bg-brand-navy/40 print:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          data-testid="details-sheet"
          onInteractOutside={(e) => {
            /* the guided-demo popover floats above the sheet and must stay clickable */
            if (!modal || (e.target as HTMLElement | null)?.closest?.('[data-demo-ui]')) e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            const el = returnFocusId ? document.getElementById(returnFocusId) : null;
            if (el) {
              e.preventDefault();
              el.focus({ preventScroll: true });
            }
          }}
          className={cn(
            'anim-sheet fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-page shadow-sheet outline-none sm:max-w-[600px] print:hidden',
            className,
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line bg-white px-4 py-2 sm:px-8">
            <Dialog.Title className="text-[17px] font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
            <Dialog.Close aria-label="Close details" className="inline-flex size-10 items-center justify-center rounded-control text-ink-2 hover:bg-brand-tint hover:text-brand">
              <X className="size-5" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-8">{children}</div>
          {footer ? <div className="border-t border-line bg-white px-4 py-3 sm:px-8">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
