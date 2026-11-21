import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLaunch } from '@/hooks/useLaunch';
import { useUi, type ApprovalTarget } from '@/hooks/useUi';
import type { Detail } from '@/lib/types';

/* Two-step named approval. Step 1: review the draft above. Step 2: type your name (2+ characters), then Approve.
   The escalation is its own separate approval. No optimistic UI: the card changes only after the server answers. */
export function ApprovalFlow({ target, d }: { target: ApprovalTarget; d: Detail }) {
  const launch = useLaunch();
  const ui = useUi();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(() => d.case?.approver || d.brief?.approver?.name || '');
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const read = useRef<HTMLButtonElement>(null);
  const trimmed = name.trim();
  const to = target === 'supplier' ? d.supplier?.name || 'the supplier' : d.escalation?.to_role || 'the approver';

  useEffect(() => {
    box.current?.scrollIntoView({ block: 'nearest' });
    if (step === 2) input.current?.focus();
    else read.current?.focus({ preventScroll: true });
  }, [step]);

  const submit = async () => {
    if (trimmed.length < 2) return;
    const ok = await launch.approve(trimmed, target);
    if (ok) ui.endApproval();
  };

  return (
    <div ref={box} role="group" aria-label="Approval" data-testid="approval-flow" className="grid gap-3 rounded-card border border-accent-ink bg-accent-wash p-4">
      <p className="m-0 text-[13px] font-semibold text-accent-ink">Step {step} of 2</p>
      {step === 1 ? (
        <>
          <p className="m-0">Read the message to {to} above. Approving does not send anything.</p>
          <div className="flex flex-wrap gap-2">
            <Button ref={read} size="sm" data-testid="review-done" onClick={() => setStep(2)}>
              I read it
            </Button>
            <Button size="sm" variant="secondary" onClick={ui.endApproval}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-1">
            <label htmlFor="name-input" className="text-[13px] font-semibold">
              Your name
            </label>
            <input
              id="name-input"
              ref={input}
              value={name}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              className="min-h-11 rounded-control border border-line-2 bg-card px-3"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" data-testid="confirm-approve" id="confirm-approve" disabled={trimmed.length < 2 || launch.busy} onClick={() => void submit()}>
              Approve
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button size="sm" variant="ghost" onClick={ui.endApproval}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
