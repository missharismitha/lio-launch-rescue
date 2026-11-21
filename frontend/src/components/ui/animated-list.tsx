import { AnimatePresence, m } from 'motion/react';
import type { ReactNode } from 'react';

export interface ListItem {
  key: string;
  node: ReactNode;
  className?: string;
  testId?: string;
}

/* Magic UI style AnimatedList: rows ease in (opacity + transform only); not animated on first paint. */
export function AnimatedList({ items, className, testId }: { items: ListItem[]; className?: string; testId?: string }) {
  return (
    <ol className={className} data-testid={testId}>
      <AnimatePresence initial={false}>
        {items.map((it) => (
          <m.li
            key={it.key}
            data-testid={it.testId}
            className={it.className}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
          >
            {it.node}
          </m.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}
