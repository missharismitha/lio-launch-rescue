import { Box, BookOpen, CreditCard, FileText, Magnet, Map as MapIcon, Package, Shield, User, type LucideIcon } from 'lucide-react';

/* Presentation only: pictures and short names for parts. Never use this to decide status or numbers. */

export type PartKey =
  | 'game-card' | 'clear-case' | 'cover-sleeve' | 'activation-leaflet' | 'steel-case' | 'collectors-box'
  | 'art-book' | 'city-map-poster' | 'statue' | 'leaflet' | 'lid-magnet' | 'generic';

export interface PartInfo {
  key: PartKey;
  name: string;
  img: string | null;
  icon: LucideIcon;
}

const P = (key: PartKey, name: string, icon: LucideIcon, hasImg = true): PartInfo => ({ key, name, img: hasImg ? `/img/parts/${key}.webp` : null, icon });

export const PARTS: Record<Exclude<PartKey, 'generic'>, PartInfo> = {
  'game-card': P('game-card', 'Game card', CreditCard),
  'clear-case': P('clear-case', 'Clear case', Package),
  'cover-sleeve': P('cover-sleeve', 'Cover sleeve', FileText),
  'activation-leaflet': P('activation-leaflet', 'Activation leaflet', FileText),
  'steel-case': P('steel-case', 'Steel case', Shield),
  'collectors-box': P('collectors-box', "Collector's box", Box),
  'art-book': P('art-book', 'Art book', BookOpen),
  'city-map-poster': P('city-map-poster', 'City map poster', MapIcon),
  statue: P('statue', 'Statue', User),
  leaflet: P('leaflet', 'Leaflet', FileText),
  'lid-magnet': P('lid-magnet', 'Lid magnet', Magnet, false), // no illustration exists
};

const BY_ID: Record<string, Exclude<PartKey, 'generic'>> = {
  'CMP-GAM-001': 'game-card',
  'CMP-GAM-002': 'game-card',
  'CMP-GAM-003': 'clear-case',
  'CMP-GAM-004': 'cover-sleeve',
  'CMP-GAM-005': 'cover-sleeve',
  'CMP-GAM-006': 'steel-case',
  'CMP-GAM-007': 'collectors-box',
  'CMP-GAM-008': 'art-book',
  'CMP-GAM-009': 'city-map-poster',
  'CMP-GAM-010': 'statue',
  'CMP-GAM-011': 'activation-leaflet',
  'CMP-MAG-005': 'lid-magnet',
};

/* first match wins, so specific phrases come before general ones */
const KEYWORDS: [RegExp, Exclude<PartKey, 'generic'>][] = [
  [/\bmagnets?\b/, 'lid-magnet'],
  [/activation|code leaflet/, 'activation-leaflet'],
  [/sleeve/, 'cover-sleeve'],
  [/steel/, 'steel-case'],
  [/art\s*book/, 'art-book'],
  [/poster|city map|\bmap\b/, 'city-map-poster'],
  [/statue/, 'statue'],
  [/clear|game card case|card case/, 'clear-case'],
  [/game\s*card/, 'game-card'],
  [/leaflet/, 'leaflet'],
  [/collector.?s?\s*box|collector/, 'collectors-box'],
  [/case/, 'clear-case'],
];

export const GENERIC_ICON: LucideIcon = Package;

export function partByKey(key: PartKey): PartInfo {
  return key === 'generic' ? { key: 'generic' as const, name: 'Part', img: null, icon: GENERIC_ICON } : PARTS[key];
}

/* Resolve by material id first, then by keywords in the text. Unknown text gives a generic result. */
export function partFor(materialIdOrText?: string | null): PartInfo {
  const text = (materialIdOrText || '').trim();
  if (!text) return partByKey('generic');
  const id = text.toUpperCase().match(/CMP-[A-Z]{3}-\d{3}/)?.[0];
  if (id && BY_ID[id]) return PARTS[BY_ID[id]];
  const low = text.toLowerCase();
  for (const [re, key] of KEYWORDS) if (re.test(low)) return PARTS[key];
  return { key: 'generic', name: text, img: null, icon: GENERIC_ICON };
}

/* Layout only. Mirrors the customer's bill of materials per copy; real numbers still come from the API. */
export interface BomItem {
  id: string;
  qty: number;
  as?: PartKey;
}
export const BOM_STANDARD: BomItem[] = [
  { id: 'CMP-GAM-001', qty: 1 },
  { id: 'CMP-GAM-003', qty: 1 },
  { id: 'CMP-GAM-004', qty: 1 },
  { id: 'CMP-GAM-011', qty: 1 },
];
export const BOM_COLLECTORS: BomItem[] = [
  { id: 'CMP-GAM-001', qty: 1 },
  { id: 'CMP-GAM-006', qty: 1 },
  { id: 'CMP-GAM-007', qty: 1 },
  { id: 'CMP-GAM-008', qty: 1 },
  { id: 'CMP-GAM-009', qty: 1 },
  { id: 'CMP-GAM-010', qty: 1 },
  { id: 'CMP-GAM-011', qty: 1, as: 'leaflet' }, // the folded Collector's leaflet picture
  { id: 'CMP-MAG-005', qty: 4 },
];
export const bomPart = (b: BomItem): PartInfo => (b.as ? partByKey(b.as) : partFor(b.id));
