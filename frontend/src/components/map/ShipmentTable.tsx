import { TriangleAlert } from 'lucide-react';
import { etaText } from '@/lib/format';
import type { MapData } from '@/lib/types';
import { supplierOf, timing } from './geo';
import { ModeChip } from './ModeChip';

export function ShipmentTable({ map }: { map: MapData }) {
  const rows = map.shipments || [];
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white">
      <table data-testid="map-table" className="w-full border-collapse text-left text-[14px] leading-5">
        <caption className="sr-only">Shipments with mode, status and arrival against the deadline</caption>
        <thead>
          <tr className="border-b border-line text-ink-2">
            {['Supplier', 'Material', 'Mode', 'Status', 'ETA', 'Vs deadline'].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const t = timing(s, map.deadline);
            return (
              <tr key={i} data-testid="map-table-row" className="border-b border-line last:border-b-0">
                <td className="px-3 py-2 font-medium text-ink">{supplierOf(map, s)?.name || 'Unknown'}</td>
                <td className="px-3 py-2 text-ink-2">{s.material || 'unknown'}</td>
                <td className="px-3 py-2">
                  <ModeChip mode={s.mode} />
                </td>
                <td className="px-3 py-2 text-ink-2">{s.status}</td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-2">{etaText(s.eta) || 'unknown'}</td>
                <td className={`px-3 py-2 font-medium whitespace-nowrap ${t.late ? 'text-risk' : 'text-ok'}`}>
                  {t.late ? <TriangleAlert className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" /> : null}
                  {t.text}
                </td>
              </tr>
            );
          })}
          {!rows.length ? (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-ink-3">
                No shipments
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
