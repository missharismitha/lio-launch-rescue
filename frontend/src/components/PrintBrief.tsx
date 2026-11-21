import { approverLabel, briefGains, recOption } from '@/lib/derive';
import { TransportPrint } from '@/components/Transport';
import { cap, etaText, num } from '@/lib/format';
import type { Detail } from '@/lib/types';

/* Only the reviewed decision brief prints: one A4 page, black on white. No message bodies, no controls. */
export function PrintBrief({ d }: { d: Detail }) {
  const b = d.brief || {};
  const gains = briefGains(d);
  const opt = recOption(d);
  const rows: [string, string][] = [
    ['Fix costs', b.price_eur != null ? `EUR ${num(b.price_eur)}` : 'unknown'],
    ['Approver', b.approver?.role ? `${approverLabel(b.approver)}` : 'unknown'],
    [gains != null ? 'Copies gained' : 'Arrives', gains != null ? num(gains) : opt?.eta ? etaText(opt.eta) : 'unknown'],
  ];
  if (b.deadline) rows.push(['Deadline', b.deadline]);
  if (b.confidence) rows.push(['Confidence', `${cap(b.confidence)}${b.confidence === 'low' ? '. Key facts are unconfirmed.' : ''}`]);
  return (
    <div aria-hidden="true" data-testid="print-brief" className="hidden bg-white p-0 text-[11pt] leading-[1.35] text-black print:block">
      <h1 className="mb-[5mm] text-[20pt] font-semibold">Decision brief</h1>
      <p>
        {d.title || ''}
        {d.supplier?.name ? `. Supplier: ${d.supplier.name}.` : ''}
      </p>
      <h2 className="mt-[5mm] mb-[2mm] text-[13pt] font-semibold">Recommendation</h2>
      <p className="text-[14pt] leading-tight">{b.recommendation || 'No recommendation yet.'}</p>
      <dl className="my-[3mm]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-[#bbb] py-[1.5mm] break-inside-avoid">
            <dt>{k}</dt>
            <dd className="m-0">{v}</dd>
          </div>
        ))}
      </dl>
      {(b.risks || []).length ? (
        <>
          <h2 className="mt-[5mm] mb-[2mm] text-[13pt] font-semibold">Risks</h2>
          <ul className="list-disc pl-[5mm]">{b.risks!.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </>
      ) : null}
      {(b.verify_next || []).length ? (
        <>
          <h2 className="mt-[5mm] mb-[2mm] text-[13pt] font-semibold">{b.confidence === 'low' ? 'What to confirm first' : "What I'd verify next"}</h2>
          <ul className="list-disc pl-[5mm]">{b.verify_next!.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </>
      ) : null}
      <TransportPrint t={d.transport} />
      <h2 className="mt-[5mm] mb-[2mm] text-[13pt] font-semibold">Numbers</h2>
      <p>
        Needed {num(d.required) || 'unknown'}. In stock (estimate) {num(d.usable_stock) || 'unknown'}. Arriving before launch {num(d.incoming) || 'unknown'}. Missing {num(d.shortage) || 'unknown'}.
      </p>
      <p className="text-[9pt]">{d.numbers_verified === true ? 'Numbers verified.' : 'Numbers not verified.'}</p>
    </div>
  );
}
