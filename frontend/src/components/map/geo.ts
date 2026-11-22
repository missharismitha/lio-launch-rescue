import { geoNaturalEarth1, geoPath, type GeoProjection } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import type { MapData, MapShipment, MapSupplier } from '@/lib/types';

export const W = 1000;
export const H = 520;

export const MODE_COLOR: Record<string, string> = { air: '#0891B2', sea: '#2B4FD4', road: '#C2410C' };
export const MODE_DASH: Record<string, string | undefined> = { air: undefined, sea: '7 5', road: '1.5 5' };
export const modeColor = (m?: string): string => MODE_COLOR[m || ''] || '#667085';

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const valid = (p?: { lat?: unknown; lon?: unknown } | null): p is { lat: number; lon: number } => !!p && num(p.lat) && num(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

export interface Placed {
  key: string;
  name: string;
  lon: number;
  lat: number;
}

/* every placeable point, keyed by lower-case code, id or name */
export function pointIndex(map: MapData): Map<string, Placed> {
  const idx = new Map<string, Placed>();
  const add = (k: string | undefined | null, p: Placed) => {
    if (k) idx.set(String(k).trim().toLowerCase(), p);
  };
  if (valid(map.hub)) add(map.hub.name, { key: 'hub', name: map.hub.name, lon: map.hub.lon, lat: map.hub.lat });
  for (const s of map.suppliers || []) if (valid(s)) add(s.id, { key: `s:${s.id}`, name: s.name, lon: s.lon, lat: s.lat });
  for (const p of map.ports || []) if (valid(p)) add(p.code, { key: `p:${p.code}`, name: p.name, lon: p.lon, lat: p.lat });
  return idx;
}

export interface Leg {
  id: string;
  mode: string;
  pts: Placed[];
  keys: string[];
}

export function resolveRoutes(map: MapData): Leg[] {
  const idx = pointIndex(map);
  const hubKey = String(map.hub?.name || '').trim().toLowerCase();
  const find = (k?: string | null): Placed | undefined => {
    const s = String(k ?? '').trim().toLowerCase();
    if (!s) return undefined;
    return idx.get(s) || (s === 'hub' && hubKey ? idx.get(hubKey) : undefined);
  };
  const legs: Leg[] = [];
  for (const r of map.routes || []) {
    const pts = [find(r.origin), find(r.via), find(r.destination)].filter((p): p is Placed => !!p);
    const uniq = pts.filter((p, i) => i === 0 || p.key !== pts[i - 1].key);
    if (uniq.length < 2) continue;
    legs.push({ id: String(r.id), mode: r.mode, pts: uniq, keys: uniq.map((p) => p.key) });
  }
  return legs;
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface View {
  proj: GeoProjection;
  vb: ViewBox;
}
export const ASPECT_DESKTOP = 2.1;
export const ASPECT_MOBILE = 1.2;

/* fit the projection to hub + suppliers + ports + shipments (8 percent padding); the viewBox is never taller than needed */
export function buildView(map: MapData, aspect: number = ASPECT_DESKTOP): View {
  const coords: [number, number][] = [];
  pointIndex(map).forEach((p) => coords.push([p.lon, p.lat]));
  for (const s of map.shipments || []) if (valid(s)) coords.push([s.lon, s.lat]);
  if (coords.length) {
    // vertical context: show land from the tropics to the Nordics so the network is not a thin band
    const mid = coords.reduce((a, c) => a + c[0], 0) / coords.length;
    coords.push([mid, -12], [mid, 66]);
  }
  const hn = Math.round(W / aspect);
  const proj = geoNaturalEarth1();
  const distinct = new Set(coords.map((c) => `${c[0]},${c[1]}`)).size >= 2;
  if (!distinct) {
    proj.fitExtent(
      [
        [10, 10],
        [W - 10, hn - 10],
      ],
      { type: 'Sphere' },
    );
    return { proj, vb: { x: 0, y: 0, w: W, h: hn } };
  }
  const padX = W * 0.08;
  const padY = hn * 0.08;
  proj.fitExtent(
    [
      [padX, padY],
      [W - padX, hn - padY],
    ],
    { type: 'MultiPoint', coordinates: coords },
  );
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const c of coords) {
    const p = proj(c);
    if (p && num(p[1])) {
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
  }
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) return { proj, vb: { x: 0, y: 0, w: W, h: hn } };
  const h = Math.min(hn, Math.max(y1 - y0 + 2 * padY, hn * 0.5));
  return { proj, vb: { x: 0, y: Math.round((y0 + y1) / 2 - h / 2), w: W, h: Math.round(h) } };
}

export function buildProjection(map: MapData): GeoProjection {
  return buildView(map).proj;
}

let landCache: ReturnType<typeof feature> | null = null;
export function landPath(proj: GeoProjection): string {
  if (!landCache) {
    const topo = world as unknown as Topology;
    const coll = topo.objects.countries as GeometryCollection;
    landCache = feature(topo, { ...coll, geometries: coll.geometries.filter((g) => String(g.id) !== '010') });
  }
  return geoPath(proj)(landCache) || '';
}

export function arcPath(proj: GeoProjection, pts: Placed[]): string {
  const g = geoPath(proj);
  return pts
    .slice(1)
    .map((p, i) => g({ type: 'LineString', coordinates: [[pts[i].lon, pts[i].lat], [p.lon, p.lat]] }) || '')
    .join('');
}

export const project = (proj: GeoProjection, p: { lon: number; lat: number }): [number, number] | null => {
  const r = proj([p.lon, p.lat]);
  return r && num(r[0]) && num(r[1]) ? [r[0], r[1]] : null;
};

/* simple greedy label placement: right, left, above, below; first slot that clears earlier labels and nodes */
export interface LabelBox {
  x: number;
  y: number;
  anchor: 'start' | 'end' | 'middle';
  ok: boolean;
}
export function placeLabels(items: { key: string; x: number; y: number; text: string }[], nodes: [number, number][], fs = 12, vb: ViewBox = { x: 0, y: 0, w: W, h: H }): Map<string, LabelBox> {
  const out = new Map<string, LabelBox>();
  const boxes: [number, number, number, number][] = [];
  const hit = (a: [number, number, number, number]) => boxes.some((b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]) || nodes.some(([nx, ny]) => nx > a[0] - 2 && nx < a[2] + 2 && ny > a[1] - 2 && ny < a[3] + 2);
  for (const it of items) {
    const w = it.text.length * fs * 0.58;
    const h = fs;
    const cands: LabelBox[] = [
      { x: it.x + 11, y: it.y + 4, anchor: 'start', ok: true },
      { x: it.x - 11, y: it.y + 4, anchor: 'end', ok: true },
      { x: it.x, y: it.y - 12, anchor: 'middle', ok: true },
      { x: it.x, y: it.y + 20, anchor: 'middle', ok: true },
    ];
    const bb = (c: LabelBox): [number, number, number, number] => {
      const x0 = c.anchor === 'start' ? c.x : c.anchor === 'end' ? c.x - w : c.x - w / 2;
      return [x0, c.y - h + 2, x0 + w, c.y + 3];
    };
    const own = (a: [number, number, number, number]) => it.x > a[0] - 2 && it.x < a[2] + 2 && it.y > a[1] - 2 && it.y < a[3] + 2;
    let pick = cands.find((c) => {
      const b = bb(c);
      return b[0] >= vb.x + 4 && b[2] <= vb.x + vb.w - 4 && b[1] >= vb.y + 4 && b[3] <= vb.y + vb.h - 4 && !own(b) && !hit(b);
    });
    if (!pick) pick = { ...cands[0], ok: false };
    out.set(it.key, pick);
    if (pick.ok) boxes.push(bb(pick));
  }
  return out;
}

/* ---- shipments ---- */
const DAY = 86_400_000;
export interface Timing {
  late: boolean;
  text: string; // "3.7 days late" | "on time" | "late"
}
export function timing(s: MapShipment, deadline?: string | null): Timing {
  const eta = s.eta ? Date.parse(s.eta) : NaN;
  const dl = deadline ? Date.parse(deadline) : NaN;
  const late = !!s.late;
  if (Number.isFinite(eta) && Number.isFinite(dl)) {
    const d = (eta - dl) / DAY;
    if (d > 0) return { late: true, text: `${(Math.round(d * 10) / 10).toFixed(1)} days late` };
    if (!late) return { late: false, text: `${(Math.round(-d * 10) / 10).toFixed(1)} days early` };
  }
  return late ? { late: true, text: 'late' } : { late: false, text: 'on time' };
}

export function supplierOf(map: MapData, s: MapShipment): MapSupplier | undefined {
  return s.supplier_id == null ? undefined : (map.suppliers || []).find((x) => x.id === s.supplier_id);
}

const norm = (s?: string | null) => String(s || '').trim().toLowerCase();
export function laneFor<T extends { supplier?: string }>(lanes: T[] | undefined, name: string): T | undefined {
  const n = norm(name);
  if (!n) return undefined;
  return (lanes || []).find((l) => norm(l.supplier) === n) || (lanes || []).find((l) => norm(l.supplier) && (norm(l.supplier).includes(n) || n.includes(norm(l.supplier))));
}

/* hub label: "Hamburg DC" for a known city word, else the first two words */
const CITIES = ['Hamburg', 'Rotterdam', 'Antwerp', 'Bremen', 'Berlin', 'Munich', 'Frankfurt', 'Cologne', 'Duisburg', 'Amsterdam', 'Warsaw', 'Lodz', 'Vienna', 'Prague'];
export function hubLabel(name?: string | null): string {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'Hub';
  const city = words.find((w) => CITIES.some((c) => c.toLowerCase() === w.toLowerCase().replace(/[^a-z]/g, '')));
  if (city) return `${city.replace(/[^\p{L}]/gu, '')} DC`;
  return words.slice(0, 2).join(' ');
}

/* compact material name: first three words, at most 22 characters */
export function shortMaterial(m?: string | null): string {
  const t = String(m || '').trim().split(/\s+/).slice(0, 3).join(' ');
  return t.length > 22 ? `${t.slice(0, 21)}…` : t || 'Material unknown';
}

export const isMoving = (status?: string | null): boolean => /^(in_transit|in_delivery)$/.test(String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_'));

/* ---- clustering (screen space) ---- */
export interface ClusterPoint {
  x: number;
  y: number;
}
export interface Cluster<T extends ClusterPoint> {
  x: number;
  y: number;
  items: T[];
}
/* greedy: a point joins the first cluster whose centre is within radius; centres are the running mean. Input order is kept in each cluster. */
export function clusterShipments<T extends ClusterPoint>(points: T[], radiusPx: number): Cluster<T>[] {
  const out: Cluster<T>[] = [];
  const r = Number.isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 0;
  for (const p of points) {
    if (!num(p.x) || !num(p.y)) continue;
    const c = r > 0 ? out.find((k) => Math.hypot(k.x - p.x, k.y - p.y) <= r) : undefined;
    if (c) {
      c.items.push(p);
      c.x += (p.x - c.x) / c.items.length;
      c.y += (p.y - c.y) / c.items.length;
    } else out.push({ x: p.x, y: p.y, items: [p] });
  }
  return out;
}
