import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import { CalendarClock, Map as MapIcon, Table2, TriangleAlert } from 'lucide-react';
import { arrivalText } from '@/components/Transport';
import { useDemoState } from '@/hooks/useUi';
import { etaText } from '@/lib/format';
import type { MapData, MapShipment, Transport } from '@/lib/types';
import { arcPath, ASPECT_DESKTOP, ASPECT_MOBILE, buildView, clusterShipments, hubLabel, isMoving, landPath, laneFor, modeColor, MODE_DASH, placeLabels, project, resolveRoutes, shortMaterial, supplierOf, timing, type Leg } from './map/geo';
import { Legend } from './map/Legend';
import { ModeIcon } from './map/ModeChip';
import { ShipmentTable } from './map/ShipmentTable';
import { SupplierPanel } from './map/SupplierPanel';

const SEA = '#EEF4FC';
const LAND = '#DCE4F2';
const CLUSTER_PX = 14;

function useMedia(q: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? !!window.matchMedia(q)?.matches : false);
  const [r, setR] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(q);
    if (!mq) return;
    const on = () => setR(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [q]);
  return r;
}
const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');

/* rendered width of the map box, so the 14 px cluster radius is real screen pixels */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(1000);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const v = Math.round(el.getBoundingClientRect().width / 20) * 20;
      if (v > 0) setW(v);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

const codeOf = (k: string) => k.replace(/^[sp]:/, '').toLowerCase();
const keyHandler = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

function Warn({ x, y }: { x: number; y: number }) {
  /* small warning triangle, white on the red marker */
  return <path d={`M${x} ${y - 4.2}L${x + 4.2} ${y + 3.2}L${x - 4.2} ${y + 3.2}Z M${x} ${y - 1}V${y + 1.2}M${x} ${y + 2.4}V${y + 2.5}`} fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />;
}

/* one shared timeline per route: a single dot with a soft trail glides origin to hub; static at 60 percent when motion is reduced */
function FlowDot({ leg, i, pathId, reduced }: { leg: Leg2; i: number; pathId: string; reduced: boolean }) {
  const color = modeColor(leg.mode);
  const body = (
    <>
      <circle r={6} fill={color} opacity={0.22} />
      <circle r={2.8} fill={color} stroke="#fff" strokeWidth="1" />
    </>
  );
  if (reduced) {
    if (!leg.mid) return null;
    return (
      <g data-testid="map-flow-dot" data-animated="no" transform={`translate(${leg.mid[0]} ${leg.mid[1]})`} aria-hidden="true">
        {body}
      </g>
    );
  }
  const dur = 6 + ((i * 5) % 9);
  const back = leg.keys[0] === 'hub';
  return (
    <g data-testid="map-flow-dot" data-animated="yes" aria-hidden="true">
      {body}
      <animateMotion dur={`${dur}s`} begin={`-${((i * 1.7) % dur).toFixed(1)}s`} repeatCount="indefinite" rotate="0" {...(back ? { keyPoints: '1;0', keyTimes: '0;1', calcMode: 'linear' } : {})}>
        <mpath href={`#${pathId}`} />
      </animateMotion>
    </g>
  );
}

type Ship = { s: MapShipment; i: number; x: number; y: number; t: ReturnType<typeof timing> };
type Leg2 = Leg & { d: string; mid: [number, number] | null };

const onLeg = (s: MapShipment, l: Leg): boolean => l.mode === s.mode && (l.keys.includes(`s:${s.supplier_id}`) || (!!s.origin && !!s.destination && l.keys.some((k) => codeOf(k) === String(s.origin).toLowerCase()) && l.keys.some((k) => codeOf(k) === String(s.destination).toLowerCase())));

export function TransportMap({ map, transport }: { map?: MapData; transport?: Transport }) {
  const reduced = useReducedMotion();
  /* guided demo only: remount the route layer so the draw-in animation plays again while the voice explains the map */
  const demoMap = useDemoState().demoScene === 'map';
  const mobile = useMedia('(max-width: 639px)');
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [view, setView] = useState<'map' | 'table'>('map');
  const [sel, setSel] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const boxW = useWidth(box);

  const base = useMemo(() => {
    if (!map || !map.hub) return null;
    const { proj, vb } = buildView(map, mobile ? ASPECT_MOBILE : ASPECT_DESKTOP);
    const legs: Leg2[] = resolveRoutes(map)
      .map((l) => {
        const a = project(proj, l.pts[0]);
        const z = project(proj, l.pts[l.pts.length - 1]);
        return { ...l, d: arcPath(proj, l.pts), mid: a && z ? ([a[0] + (z[0] - a[0]) * 0.6, a[1] + (z[1] - a[1]) * 0.6] as [number, number]) : null };
      })
      .filter((l) => l.d);
    const hub = project(proj, map.hub);
    const sups = (map.suppliers || []).flatMap((s) => {
      const p = project(proj, s);
      return p ? [{ s, x: p[0], y: p[1] }] : [];
    });
    const ports = (map.ports || []).flatMap((s) => {
      const p = project(proj, s);
      return p ? [{ s, x: p[0], y: p[1] }] : [];
    });
    const ships: Ship[] = (map.shipments || []).flatMap((s, i) => {
      const p = s.lat != null && s.lon != null ? project(proj, { lat: s.lat, lon: s.lon }) : null;
      return p ? [{ s, i, x: p[0], y: p[1], t: timing(s, map.deadline) }] : [];
    });
    ships.sort((a, b) => Number(a.t.late) - Number(b.t.late));
    const hubText = hubLabel(map.hub.name);
    const items = [...(hub ? [{ key: 'hub', x: hub[0], y: hub[1], text: hubText }] : []), ...sups.map((n) => ({ key: n.s.id, x: n.x, y: n.y, text: n.s.name }))];
    const nodes: [number, number][] = [...(hub ? [hub] : []), ...sups.map((n): [number, number] => [n.x, n.y]), ...ports.map((n): [number, number] => [n.x, n.y])];
    const moving = legs.map((l) => (map.shipments || []).some((s) => isMoving(s.status) && onLeg(s, l)));
    return { vb, land: landPath(proj), legs, moving, hub, hubText, sups, ports, ships, labels: placeLabels(items, nodes, 12, vb) };
  }, [map, mobile]);

  /* screen-space clustering: 14 px of rendered map */
  const clusters = useMemo(() => (base ? clusterShipments(base.ships, CLUSTER_PX / Math.max(0.2, boxW / base.vb.w)) : []), [base, boxW]);
  const geo = base;

  if (!map || !map.hub || !geo) {
    return (
      <section data-testid="transport-map" aria-label="Transport map" className="grid place-items-center rounded-2xl border border-line bg-white p-8 text-[14px] text-ink-3 shadow-card">
        Map data not available yet
      </section>
    );
  }

  const selSup = sel ? (map.suppliers || []).find((s) => s.id === sel) : undefined;
  const selShipments = selSup ? (map.shipments || []).filter((s) => s.supplier_id === selSup.id) : [];
  const related = (l: (typeof geo.legs)[number]): boolean => {
    if (!selSup) return true;
    if (l.keys.includes(`s:${selSup.id}`)) return true;
    return selShipments.some((s) => s.mode === l.mode && l.keys.some((k) => codeOf(k) === String(s.origin || '').toLowerCase()) && l.keys.some((k) => codeOf(k) === String(s.destination || '').toLowerCase()));
  };
  const relatedShip = (s: MapShipment) => !selSup || s.supplier_id === selSup.id;

  const total = (map.shipments || []).length;
  const lateN = (map.shipments || []).filter((s) => timing(s, map.deadline).late).length;
  const dl = arrivalText(map.deadline || transport?.deadline);
  const lane = selSup ? laneFor(transport?.lanes, selSup.name) : undefined;
  const toggle = (id: string) => setSel((c) => (c === id ? null : id));
  const tipCluster = tip != null ? clusters.find((c) => `c${c.items[0].i}` === tip || `s${c.items[0].i}` === tip) : undefined;
  const vb = geo.vb;
  const mkTip = (k: string) => ({
    onMouseEnter: () => setTip(k),
    onMouseLeave: () => setTip((c) => (c === k ? null : c)),
    onFocus: () => setTip(k),
    onBlur: () => setTip((c) => (c === k ? null : c)),
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      setTip((c) => (c === k ? null : k));
    },
  });

  const btn = (on: boolean) => `inline-flex min-h-9 items-center gap-1.5 rounded-[10px] px-3 text-[14px] font-medium ${on ? 'bg-brand text-white' : 'text-ink-2 hover:bg-page'}`;

  return (
    <section data-testid="transport-map" data-demo="map" aria-label="Transport map" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div data-testid="map-deadline" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] leading-5 text-ink">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <CalendarClock className="size-4 text-brand" aria-hidden="true" />
            {dl ? `Deadline ${dl}` : 'Deadline unknown'}
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-risk">
            <TriangleAlert className="size-4" aria-hidden="true" />
            {lateN} late
          </span>
          <span className="font-semibold text-ok">{total - lateN} on time</span>
        </div>
        <div role="group" aria-label="View" className="inline-flex rounded-[12px] border border-line bg-white p-0.5">
          <button type="button" className={btn(view === 'map')} aria-pressed={view === 'map'} onClick={() => setView('map')}>
            <MapIcon className="size-4" aria-hidden="true" />
            Map
          </button>
          <button type="button" className={btn(view === 'table')} aria-pressed={view === 'table'} onClick={() => setView('table')}>
            <Table2 className="size-4" aria-hidden="true" />
            Table
          </button>
        </div>
      </div>

      {view === 'table' ? (
        <ShipmentTable map={map} />
      ) : (
        <div className={`grid gap-3 ${selSup ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
          <div ref={box} className="relative overflow-hidden rounded-2xl border border-line shadow-card" style={{ background: SEA }}>
            <div className="pointer-events-none absolute inset-1.5 z-[1] rounded-xl border border-white/80" aria-hidden="true" />
            <div className="overflow-x-auto sm:overflow-visible"><div className="min-w-[780px] sm:min-w-0"><svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="group" aria-label="World map of suppliers, routes and shipments" className="block h-auto w-full" onClick={(e) => e.target === e.currentTarget && setSel(null)}>
              <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={SEA} onClick={() => setSel(null)} />
              <path d={geo.land} fill={LAND} stroke="#fff" strokeWidth="0.75" strokeLinejoin="round" />

              {/* routes */}
              <g key={demoMap ? 'demo' : 'base'} fill="none" strokeLinecap="round">
                {geo.legs.map((l, i) => {
                  const on = related(l);
                  const maskId = `rm${uid}${i}`;
                  return (
                    <g key={i} data-testid="map-route" data-mode={l.mode} opacity={on ? (selSup ? 1 : 0.85) : 0.18}>
                      {reduced ? null : (
                        <mask id={maskId} maskUnits="userSpaceOnUse" x={vb.x} y={vb.y} width={vb.w} height={vb.h}>
                          <motion.path d={l.d} stroke="#fff" strokeWidth="8" fill="none" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, delay: 0.1 + i * 0.04, ease: 'easeOut' }} />
                        </mask>
                      )}
                      <path id={`rp${uid}${i}`} d={l.d} stroke={modeColor(l.mode)} strokeWidth={2} strokeDasharray={MODE_DASH[l.mode]} mask={reduced ? undefined : `url(#${maskId})`} />
                      {geo.moving[i] ? <FlowDot leg={l} i={i} pathId={`rp${uid}${i}`} reduced={reduced} /> : null}
                    </g>
                  );
                })}
              </g>

              {/* ports */}
              {geo.ports.map((p) => (
                <circle key={p.s.code} cx={p.x} cy={p.y} r={3.2} fill="#fff" stroke="#667085" strokeWidth="1.2">
                  <title>{p.s.name}</title>
                </circle>
              ))}

              {/* hub */}
              {geo.hub ? (
                <g data-testid="map-hub" role="img" aria-label={`Hub: ${map.hub.name}`}>
                  <circle cx={geo.hub[0]} cy={geo.hub[1]} r={8} fill="#D9381E" opacity={0.35} className="origin-center animate-ping motion-reduce:animate-none [transform-box:fill-box]" />
                  <circle cx={geo.hub[0]} cy={geo.hub[1]} r={7} fill="#D9381E" stroke="#fff" strokeWidth="2" />
                </g>
              ) : null}

              {/* suppliers */}
              {geo.sups.map((n) => {
                const on = sel === n.s.id;
                return (
                  <g
                    key={n.s.id}
                    data-testid="map-supplier"
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    aria-label={`${n.s.name}${n.s.country ? `, ${n.s.country}` : ''}. Show transport options`}
                    className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-ink"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(n.s.id);
                    }}
                    onKeyDown={keyHandler(() => toggle(n.s.id))}
                  >
                    <circle cx={n.x} cy={n.y} r={16} fill="transparent" stroke="transparent" strokeWidth="2" />
                    <circle cx={n.x} cy={n.y} r={on ? 7.5 : 6} fill="#0B1F5C" stroke="#fff" strokeWidth="2" />
                  </g>
                );
              })}

              {/* shipments: singles keep their own marker, near neighbours share a count badge */}
              {clusters.map((c) => {
                const first = c.items[0];
                if (c.items.length === 1) {
                  const { s, i, x, y, t } = first;
                  const dim = !relatedShip(s);
                  const who = supplierOf(map, s)?.name || 'Shipment';
                  const label = `${who}, ${s.material || 'material unknown'}, ${s.mode}, ${s.status}, ${t.text}`;
                  return (
                    <g key={`s${i}`} data-testid="map-shipment" data-late={t.late ? 'yes' : 'no'} role="img" tabIndex={0} aria-label={label} opacity={dim ? 0.3 : 1} className="cursor-default outline-none [&:focus-visible>circle:first-child]:stroke-ink" {...mkTip(`s${i}`)}>
                      <circle cx={x} cy={y} r={14} fill="transparent" stroke="transparent" strokeWidth="2" />
                      {t.late ? <circle cx={x} cy={y} r={7} fill="#B42318" opacity={0.3} className="origin-center animate-ping motion-reduce:animate-none [transform-box:fill-box]" /> : null}
                      <circle cx={x} cy={y} r={t.late ? 7.5 : 5.5} fill={t.late ? '#B42318' : modeColor(s.mode)} stroke="#fff" strokeWidth="2" />
                      {t.late ? <Warn x={x} y={y} /> : null}
                    </g>
                  );
                }
                const lateC = c.items.filter((m) => m.t.late).length;
                const dim = !c.items.some((m) => relatedShip(m.s));
                const modes = c.items.map((m) => m.s.mode);
                const dom = [...modes].sort((p, q) => modes.filter((v) => v === q).length - modes.filter((v) => v === p).length)[0];
                const fill = lateC ? '#B42318' : modeColor(dom);
                const k = `c${first.i}`;
                return (
                  <g key={k} data-testid="map-cluster" data-count={c.items.length} data-late={lateC ? 'yes' : 'no'} role="img" tabIndex={0} aria-label={`${c.items.length} shipments${lateC ? `, ${lateC} late` : ', none late'}`} opacity={dim ? 0.3 : 1} className="cursor-default outline-none [&:focus-visible>circle:first-child]:stroke-ink" {...mkTip(k)}>
                    <circle cx={c.x} cy={c.y} r={16} fill="transparent" stroke="transparent" strokeWidth="2" />
                    <circle cx={c.x} cy={c.y} r={10.5} fill={fill} stroke="#fff" strokeWidth="2" />
                    <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" pointerEvents="none" stroke="none">
                      {c.items.length}
                    </text>
                    {lateC ? (
                      <g pointerEvents="none">
                        <circle cx={c.x + 8} cy={c.y - 8} r={5} fill="#fff" />
                        <path d={`M${c.x + 8} ${c.y - 11}L${c.x + 11} ${c.y - 6}L${c.x + 5} ${c.y - 6}Z`} fill="#B42318" />
                      </g>
                    ) : null}
                  </g>
                );
              })}
              {/* labels */}
              <g fontSize="12" fontWeight="600" fill="#101828" pointerEvents="none" style={{ paintOrder: 'stroke' }} stroke="#fff" strokeWidth="3" strokeLinejoin="round">
                {geo.hub ? (
                  <text x={geo.labels.get('hub')?.x} y={geo.labels.get('hub')?.y} textAnchor={geo.labels.get('hub')?.anchor}>
                    {geo.hubText}
                  </text>
                ) : null}
                {geo.sups.map((n) => {
                  const b = geo.labels.get(n.s.id);
                  const on = sel === n.s.id;
                  if (!b || (!b.ok && !on)) return null;
                  return (
                    <text key={n.s.id} x={b.x} y={b.y} textAnchor={b.anchor} className={on ? '' : 'max-sm:hidden'}>
                      {n.s.name}
                      {n.s.country ? <tspan fontWeight="400" fill="#475467">{`, ${n.s.country}`}</tspan> : null}
                    </text>
                  );
                })}
              </g>
            </svg></div></div>

            {tipCluster ? (
              <div data-testid="map-tooltip" role="tooltip" className="pointer-events-none absolute z-10 grid max-w-[300px] gap-1 rounded-xl border border-line bg-white px-3 py-2 text-[13px] leading-5 shadow-sheet" style={{ left: `${((tipCluster.x - vb.x) / vb.w) * 100}%`, top: `${((tipCluster.y - vb.y) / vb.h) * 100}%`, transform: tipCluster.x > vb.x + vb.w * 0.6 ? 'translate(calc(-100% - 14px), -50%)' : 'translate(14px, -50%)' }}>
                {tipCluster.items.length === 1 ? (
                  <>
                    <b className="font-semibold text-ink">{supplierOf(map, tipCluster.items[0].s)?.name || 'Shipment'}</b>
                    <span className="text-ink-2">{tipCluster.items[0].s.material || 'Material unknown'}</span>
                    <span className="inline-flex items-center gap-1.5 text-ink-2">
                      <ModeIcon mode={tipCluster.items[0].s.mode} className="size-3.5" />
                      {`${tipCluster.items[0].s.mode}, ${tipCluster.items[0].s.status}`}
                    </span>
                    <span className="text-ink-2">{tipCluster.items[0].s.eta ? `ETA ${etaText(tipCluster.items[0].s.eta)}` : 'ETA unknown'}</span>
                    <span className={`inline-flex items-center gap-1 font-semibold ${tipCluster.items[0].t.late ? 'text-risk' : 'text-ok'}`}>
                      {tipCluster.items[0].t.late ? <TriangleAlert className="size-3.5" aria-hidden="true" /> : null}
                      {tipCluster.items[0].t.text}
                    </span>
                  </>
                ) : (
                  <>
                    <b className="font-semibold text-ink">{`${tipCluster.items.length} shipments`}</b>
                    {[...tipCluster.items].sort((p, q) => Number(q.t.late) - Number(p.t.late)).slice(0, 8).map((m) => (
                      <span key={m.i} data-testid="map-cluster-row" className="flex items-center gap-1.5 text-ink-2">
                        <ModeIcon mode={m.s.mode} className="size-3.5 shrink-0" />
                        <span className="min-w-0 truncate">{`${supplierOf(map, m.s)?.name || 'Shipment'}, ${shortMaterial(m.s.material)}, ${String(m.s.status || '').replace(/_/g, ' ')}`}</span>
                        <span className={`ml-auto shrink-0 font-semibold ${m.t.late ? 'text-risk' : 'text-ok'}`}>{m.t.late ? `+${m.t.text}` : m.t.text}</span>
                      </span>
                    ))}
                    {tipCluster.items.length > 8 ? <span className="text-ink-3">{`+${tipCluster.items.length - 8} more`}</span> : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
          {selSup ? <SupplierPanel supplier={selSup} lane={lane} transport={transport} onClose={() => setSel(null)} /> : null}
        </div>
      )}
      <Legend />
    </section>
  );
}
