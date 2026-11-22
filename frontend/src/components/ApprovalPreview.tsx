import { BookOpen, CircleCheck, ClipboardCheck, FileDown, Send, UserPen, type LucideIcon } from 'lucide-react';
import { useDemoReplay } from '@/hooks/useDemoReplay';

/* Guided-demo illustration of the real approval steps (ApprovalFlow, ManualSend, reply review).
   Inert on purpose: no buttons, no inputs, no focus, no calls to approve, send or import, no state of the case.
   It renders only while its demo scene is being narrated and shows the same thing whether or not the case
   is already approved or sent. The beats follow the scene clock (0..1) from useDemoReplay. */

type Kind = 'escalation' | 'email';

interface Beat {
  Icon: LucideIcon;
  label: string;
  hint: string;
}

export const PREVIEW_BEATS: Record<Kind, Beat[]> = {
  escalation: [
    { Icon: BookOpen, label: 'Read it', hint: 'A person reads the message.' },
    { Icon: UserPen, label: 'Type your name', hint: 'Two characters or more.' },
    { Icon: CircleCheck, label: 'Approve', hint: 'Approving sends nothing.' },
  ],
  email: [
    { Icon: Send, label: 'Send from your own inbox', hint: 'A person sends it, not the agent.' },
    { Icon: FileDown, label: 'Reply comes back as a file', hint: 'The reply is imported as a .eml file.' },
    { Icon: ClipboardCheck, label: 'Review', hint: 'A person checks it before any number changes.' },
  ],
};

/* which beat is lit at fraction f (0..1): thirds */
export const beatAt = (f: number, n = 3): number => Math.min(n - 1, Math.max(0, Math.floor(f * n)));

export function ApprovalPreview({ kind }: { kind: Kind }) {
  const f = useDemoReplay(kind);
  if (f === null) return null;
  const beats = PREVIEW_BEATS[kind];
  const at = beatAt(f, beats.length);
  const cur = beats[at];
  return (
    <div
      role="img"
      aria-label={`Preview, nothing is sent or approved. Step ${at + 1} of ${beats.length}: ${cur.label}.`}
      data-testid={`preview-${kind}`}
      data-beat={at}
      className="pointer-events-none grid gap-3 rounded-card border border-brand-100 bg-brand-tint p-4 select-none"
    >
      <div className="flex items-center justify-between gap-2" aria-hidden="true">
        <span className="rounded-full bg-brand px-2.5 text-[12px] leading-6 font-semibold tracking-wide text-white uppercase">Preview</span>
        <span className="text-[13px] text-ink-2">Nothing is sent or approved</span>
      </div>
      <ol className="m-0 grid list-none gap-2 p-0" aria-hidden="true">
        {beats.map((b, n) => {
          const on = n === at;
          const done = n < at;
          return (
            <li
              key={b.label}
              data-on={on ? 'true' : 'false'}
              className={`flex items-center gap-3 rounded-control border px-3 py-2 motion-safe:transition-colors motion-safe:duration-300 ${
                on ? 'border-brand bg-white text-ink shadow-sm' : done ? 'border-ok/30 bg-ok-tint text-ok' : 'border-line bg-white/60 text-ink-3'
              }`}
            >
              <b.Icon className={`size-5 shrink-0 ${on ? 'text-brand' : ''}`} aria-hidden="true" />
              <span className="grid gap-0.5">
                <span className="text-[14px] leading-5 font-semibold">{`${n + 1}. ${b.label}`}</span>
                {on ? <span className="text-[13px] leading-4 text-ink-2">{b.hint}</span> : null}
              </span>
              {kind === 'escalation' && n === 1 && on ? (
                <span className="ml-auto rounded-control border border-line-2 bg-white px-3 py-1 text-[13px] text-ink-3">Your name</span>
              ) : null}
              {kind === 'escalation' && n === 2 ? (
                <span
                  data-testid="preview-approve"
                  data-lit={on ? 'true' : 'false'}
                  className={`ml-auto rounded-control px-3 py-1 text-[13px] font-semibold ${on ? 'bg-brand text-white' : 'bg-line text-ink-3'}`}
                >
                  Approve
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
