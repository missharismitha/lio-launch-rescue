import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransportMap } from '@/components/TransportMap';
import { clusterShipments, hubLabel } from '@/components/map/geo';
import type { MapData, Transport } from '@/lib/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SECRET_SHIP = 'SHIP-SECRET-9f3a';
const SECRET_SUP = 'SUP-SECRET-77b1';
const SECRET_ROUTE = 'ROUTE-SECRET-42c0';

const map: MapData = {
  as_of: '2026-11-20T08:00:00Z',
  deadline: '2026-11-22T19:00:00Z',
  hub: { name: 'Hamburg DC', lat: 53.55, lon: 9.99 },
  suppliers: [
    { id: SECRET_SUP, name: 'Hwaseong Cards', country: 'South Korea', lat: 37.2, lon: 126.8 },
    { id: 'sup-b', name: 'Lodz Print', country: 'Poland', lat: 51.75, lon: 19.45 },
  ],
  ports: [
    { code: 'KRPUS', name: 'Busan', lat: 35.1, lon: 129.04, mode: 'sea' },
    { code: 'DEHAM', name: 'Hamburg Port', lat: 53.54, lon: 9.97, mode: 'sea' },
  ],
  routes: [
    { id: SECRET_ROUTE, mode: 'sea', origin: SECRET_SUP, destination: 'DEHAM', via: 'KRPUS', transit_days: 30 },
    { id: 'r2', mode: 'road', origin: 'sup-b', destination: 'Hamburg DC', transit_days: 2 },
    { id: 'r3', mode: 'air', origin: 'NOWHERE', destination: 'ALSONOWHERE' },
  ],
  shipments: [
    { id: SECRET_SHIP, supplier_id: SECRET_SUP, mode: 'sea', status: 'in transit', origin: 'KRPUS', destination: 'DEHAM', lat: 20, lon: 80, eta: '2026-11-26T11:00:00Z', late: true, material: 'Art cards' },
    { id: 's2', supplier_id: 'sup-b', mode: 'road', status: 'in transit', lat: 52, lon: 15, eta: '2026-11-21T10:00:00Z', late: false, material: 'Manuals' },
  ],
};

const transport: Transport = {
  estimate: true,
  deadline: '2026-11-22T19:00:00Z',
  lanes: [
    {
      supplier: 'Hwaseong Cards',
      fastest: 'air',
      cheapest_feasible: null,
      modes: [
        { mode: 'air', feasible: false, hours_margin: -20, cost_eur: { low: 1500, base: 1800, high: 3200 }, verdict: 'Customs adds a day' },
        { mode: 'sea', feasible: false, hours_margin: -200, cost_eur: { low: 300, base: 400, high: 700 }, verdict: 'Far too slow' },
      ],
    },
  ],
};

describe('TransportMap', () => {
  it('shows an empty state without map data', () => {
    render(<TransportMap map={undefined} transport={transport} />);
    expect(screen.getByText('Map data not available yet')).toBeTruthy();
  });

  it('places hub and suppliers and skips routes it cannot place', () => {
    render(<TransportMap map={map} transport={transport} />);
    expect(screen.getByTestId('map-hub').getAttribute('aria-label')).toBe('Hub: Hamburg DC');
    expect(screen.getAllByTestId('map-supplier').length).toBe(2);
    expect(screen.getAllByTestId('map-route').length).toBe(2);
    expect(screen.getByTestId('map-legend')).toBeTruthy();
    expect(screen.getByTestId('map-deadline').textContent).toMatch(/Deadline Sun 20:00/);
    expect(screen.getByTestId('map-deadline').textContent).toMatch(/1 late/);
    expect(screen.getByTestId('map-deadline').textContent).toMatch(/1 on time/);
  });

  it('marks late shipments and says how late on hover', () => {
    render(<TransportMap map={map} transport={transport} />);
    const ships = screen.getAllByTestId('map-shipment');
    const late = ships.find((s) => s.getAttribute('data-late') === 'yes')!;
    expect(late.getAttribute('aria-label')).toMatch(/3\.7 days late/);
    fireEvent.focus(late);
    expect(within(screen.getByTestId('map-tooltip')).getByText('3.7 days late')).toBeTruthy();
    expect(ships.filter((s) => s.getAttribute('data-late') === 'no').length).toBe(1);
  });

  it('selecting a supplier shows its lane with est. costs and no feasible badge when infeasible', () => {
    render(<TransportMap map={map} transport={transport} />);
    expect(screen.queryByTestId('map-panel')).toBeNull();
    fireEvent.keyDown(screen.getByLabelText(/Hwaseong Cards, South Korea/), { key: 'Enter' });
    const panel = screen.getByTestId('map-panel');
    const rows = within(panel).getAllByTestId('map-lane-mode');
    expect(rows.length).toBe(2);
    expect(within(panel).getByText('est. EUR 1,500 to 3,200')).toBeTruthy();
    expect(within(panel).queryByText('Makes it')).toBeNull();
    expect(within(panel).getAllByText('Too late').length).toBe(2);
    expect(within(panel).getByText('Fastest')).toBeTruthy();
    expect(within(panel).queryByText('Cheapest that makes it')).toBeNull();
    fireEvent.click(screen.getByLabelText('Close supplier panel'));
    expect(screen.queryByTestId('map-panel')).toBeNull();
  });

  it('table view lists every shipment', () => {
    render(<TransportMap map={map} transport={transport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getAllByTestId('map-table-row').length).toBe(2);
    expect(screen.getByText('3.7 days late')).toBeTruthy();
    expect(screen.getByText('Manuals')).toBeTruthy();
    expect(screen.queryByTestId('map-hub')).toBeNull();
  });

  it('leaks no ids or references into the DOM', () => {
    const { container } = render(<TransportMap map={map} transport={transport} />);
    fireEvent.click(screen.getByLabelText(/Hwaseong Cards, South Korea/));
    fireEvent.focus(screen.getAllByTestId('map-shipment')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    for (const secret of [SECRET_SHIP, SECRET_SUP, SECRET_ROUTE, 'DEHAM', 'KRPUS']) expect(container.innerHTML).not.toContain(secret);
  });

  it('skips the draw-in mask when the user prefers reduced motion', () => {
    const mm = (matches: boolean) => vi.fn().mockImplementation((q: string) => ({ matches, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal('matchMedia', mm(true));
    const a = render(<TransportMap map={map} transport={transport} />);
    expect(a.container.querySelectorAll('mask').length).toBe(0);
    a.unmount();
    vi.stubGlobal('matchMedia', mm(false));
    const b = render(<TransportMap map={map} transport={transport} />);
    expect(b.container.querySelectorAll('mask').length).toBe(2);
  });

  it('labels the hub simply and keeps the full name in the aria-label', () => {
    const long: MapData = { ...map, hub: { name: 'Soony Distribution Center Hamburg', lat: 53.55, lon: 9.99 } };
    const { container } = render(<TransportMap map={long} transport={transport} />);
    expect(screen.getByTestId('map-hub').getAttribute('aria-label')).toBe('Hub: Soony Distribution Center Hamburg');
    const texts = Array.from(container.querySelectorAll('svg text')).map((t) => t.textContent);
    expect(texts).toContain('Hamburg DC');
    expect(texts.some((t) => /Distribution/.test(t || ''))).toBe(false);
    expect(hubLabel('Soony Distribution Center Hamburg')).toBe('Hamburg DC');
    expect(hubLabel('Hamburg DC')).toBe('Hamburg DC');
    expect(hubLabel('Main Warehouse North')).toBe('Main Warehouse');
    expect(hubLabel('')).toBe('Hub');
  });

  it('clusters overlapping shipments into one count badge and lists them compactly', () => {
    const near = (id: string, late: boolean, material: string, status = 'in_transit') => ({ id, supplier_id: 'sup-b', mode: 'road' as const, status, lat: 53.5, lon: 10, eta: late ? '2026-11-24T10:00:00Z' : '2026-11-21T10:00:00Z', late, material });
    const crowded: MapData = { ...map, shipments: [near('a', true, 'Art cards for the collector box edition'), near('b', true, 'Manuals'), near('c', false, 'Leaflets'), { ...map.shipments![1], lat: 37, lon: 126 }] };
    render(<TransportMap map={crowded} transport={transport} />);
    const cl = screen.getByTestId('map-cluster');
    expect(cl.getAttribute('data-count')).toBe('3');
    expect(cl.getAttribute('data-late')).toBe('yes');
    expect(cl.textContent).toBe('3');
    expect(screen.getAllByTestId('map-shipment').length).toBe(1);
    fireEvent.focus(cl);
    const rows = within(screen.getByTestId('map-tooltip')).getAllByTestId('map-cluster-row');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toMatch(/Lodz Print, Art cards for, in transit.*\+\d\.\d days late/);
  });

  it('shows travelling dots, static when motion is reduced', () => {
    const mm = (matches: boolean) => vi.fn().mockImplementation((q: string) => ({ matches: q.includes('reduced-motion') ? matches : false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal('matchMedia', mm(false));
    const a = render(<TransportMap map={map} transport={transport} />);
    const dots = a.container.querySelectorAll('[data-testid="map-flow-dot"]');
    expect(dots.length).toBe(2);
    expect(a.container.querySelectorAll('animateMotion').length).toBe(2);
    a.unmount();
    vi.stubGlobal('matchMedia', mm(true));
    const b = render(<TransportMap map={map} transport={transport} />);
    expect(b.container.querySelectorAll('[data-testid="map-flow-dot"]').length).toBe(2);
    expect(b.container.querySelectorAll('animateMotion').length).toBe(0);
  });
});

describe('clusterShipments', () => {
  const p = (x: number, y: number) => ({ x, y });
  it('handles empty input and non-positive radius', () => {
    expect(clusterShipments([], 14)).toEqual([]);
    expect(clusterShipments([p(0, 0), p(0, 0)], 0).length).toBe(2);
    expect(clusterShipments([p(0, 0), p(0, 0)], NaN).length).toBe(2);
  });
  it('merges points within the radius, keeps distant ones apart', () => {
    const r = clusterShipments([p(0, 0), p(10, 0), p(14, 0), p(100, 100)], 14);
    expect(r.map((c) => c.items.length)).toEqual([3, 1]);
    expect(r[1].x).toBe(100);
  });
  it('treats exactly-radius as inside and just beyond as outside', () => {
    expect(clusterShipments([p(0, 0), p(14, 0)], 14).length).toBe(1);
    expect(clusterShipments([p(0, 0), p(14.5, 0)], 14).length).toBe(2);
  });
  it('centres on the mean and keeps input order, skipping non-finite points', () => {
    const r = clusterShipments([{ x: 0, y: 0, id: 'a' }, { x: 6, y: 0, id: 'b' }, { x: NaN, y: 1, id: 'c' }], 14);
    expect(r.length).toBe(1);
    expect(r[0].x).toBe(3);
    expect(r[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});
