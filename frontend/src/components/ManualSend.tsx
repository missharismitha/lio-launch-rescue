import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { RiskNote } from '@/components/common';
import { useLaunch } from '@/hooks/useLaunch';
import { api, apiRaw, issuePath } from '@/lib/api';
import type { Detail } from '@/lib/types';

interface Handoff {
  to: string;
  subject: string;
  body: string;
}

export const MAX_EML = 2 * 1024 * 1024;
export const SENT_MARK = 'Marked as sent by hand. Delivery is not confirmed.';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea fallback */
  }
  try {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch {
    return false;
  }
}

/* Send it yourself: the operator sends the approved inquiry from their own mail.
   The address is fetched only when this panel opens and lives only in this component's state. */
export function ManualSend({ d, id }: { d: Detail; id: string }) {
  const launch = useLaunch();
  const [open, setOpen] = useState(false);
  const [h, setH] = useState<Handoff | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(() => d.case?.approver || '');
  const trimmed = name.trim();

  const show = async () => {
    setOpen(true);
    setErr('');
    setLoading(true);
    try {
      setH(await api<Handoff>(issuePath(id, 'handoff')));
    } catch (e) {
      setErr((e as Error).message || 'Could not load the message.');
    }
    setLoading(false);
  };

  const close = () => {
    setOpen(false);
    setH(null);
    setConfirming(false);
    setErr('');
  };

  const copy = async (v: string) => toast((await copyText(v)) ? 'Copied' : 'Could not copy. Select the text and copy it by hand.');

  const mark = async () => {
    if (trimmed.length < 2) return;
    const ok = await launch.act(() => api(issuePath(id, 'mark-sent'), { sent_by: trimmed }), SENT_MARK);
    if (ok) close();
  };

  if (!open) {
    return (
      <div>
        <Button data-testid="handoff-open" id="approve" className="w-full sm:w-auto" onClick={() => void show()}>
          Send it yourself…
        </Button>
      </div>
    );
  }

  return (
    <div role="group" aria-label="Send it yourself" data-testid="handoff" className="grid gap-3 border-t-2 border-ink pt-4">
      <p className="m-0 max-w-[64ch] text-ink-2">
        Send it from the registered sender address. Keep the subject exactly as it is, including the [Lio ...] tag, or the reply cannot be matched.
      </p>
      {loading ? <p className="m-0 text-ink-2">Loading the message.</p> : null}
      {err ? <RiskNote>{err}</RiskNote> : null}
      {h ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void copy(h.to)}>Copy address</Button>
          <Button size="sm" variant="secondary" onClick={() => void copy(h.subject)}>Copy subject</Button>
          <Button size="sm" variant="secondary" onClick={() => void copy(h.body)}>Copy message</Button>
        </div>
      ) : null}
      {h && !confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" data-testid="i-sent-it" onClick={() => setConfirming(true)}>I sent it</Button>
          <Button size="sm" variant="ghost" onClick={close}>Close</Button>
        </div>
      ) : null}
      {h && confirming ? (
        <>
          <div className="grid gap-1">
            <label htmlFor="sent-by" className="text-[14px] font-semibold">Your name</label>
            <input
              id="sent-by"
              value={name}
              autoComplete="name"
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void mark();
              }}
              className="min-h-11 rounded-control border border-line-2 bg-white px-3"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" data-testid="confirm-sent" disabled={trimmed.length < 2 || launch.busy} onClick={() => void mark()}>
              Mark as sent
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>Back</Button>
          </div>
        </>
      ) : null}
      {!h && !loading ? (
        <div><Button size="sm" variant="ghost" onClick={close}>Close</Button></div>
      ) : null}
    </div>
  );
}

/* Bring the supplier's reply back as an .eml file. The server checks sender and tag. */
export function ImportReply({ id }: { id: string }) {
  const launch = useLaunch();
  const [msg, setMsg] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setMsg('');
    if (f.size > MAX_EML) {
      setMsg('That file is larger than 2 MB. Choose the reply message only, without attachments.');
      if (input.current) input.current.value = '';
      return;
    }
    const bytes = await f.arrayBuffer();
    await launch.act(async () => {
      try {
        await apiRaw(issuePath(id, 'replies/import'), bytes, 'message/rfc822');
      } catch (e) {
        setMsg((e as Error).message);
        throw e;
      }
    }, 'Reply imported. Review it before anything is ordered.');
    if (input.current) input.current.value = '';
  };

  return (
    <div className="grid gap-1">
      <label htmlFor="eml-input" className="text-[14px] font-semibold">Import a reply</label>
      <p id="eml-help" className="m-0 text-[14px] text-ink-2">
        Choose the reply as a .eml file. In Gmail: open the message, three dots, Download message.
      </p>
      <input
        id="eml-input"
        ref={input}
        type="file"
        accept=".eml,message/rfc822"
        aria-describedby="eml-help"
        disabled={launch.busy}
        onChange={(e) => void pick(e.target.files?.[0])}
        className="min-h-11 py-2 text-[14px]"
      />
      {msg ? <p role="alert" className="m-0 text-[14px] font-semibold text-risk">{msg}</p> : null}
    </div>
  );
}
