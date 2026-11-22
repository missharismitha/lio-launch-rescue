import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PartImage } from '@/components/PartImage';
import { BomSection, Parts } from '@/components/Parts';
import { TransportSection } from '@/components/Transport';
import { BOM_COLLECTORS, BOM_STANDARD, partFor } from '@/lib/parts';
import type { Overview, Transport } from '@/lib/types';

afterEach(cleanup);

describe('partFor', () => {
  it('resolves every material id', () => {
    const want: Record<string, [string, string]> = {
      'CMP-GAM-001': ['game-card', 'Game card'],
      'CMP-GAM-002': ['game-card', 'Game card'],
      'CMP-GAM-003': ['clear-case', 'Clear case'],
      'CMP-GAM-004': ['cover-sleeve', 'Cover sleeve'],
      'CMP-GAM-005': ['cover-sleeve', 'Cover sleeve'],
      'CMP-GAM-006': ['steel-case', 'Steel case'],
      'CMP-GAM-007': ['collectors-box', "Collector's box"],
      'CMP-GAM-008': ['art-book', 'Art book'],
      'CMP-GAM-009': ['city-map-poster', 'City map poster'],
      'CMP-GAM-010': ['statue', 'Statue'],
      'CMP-GAM-011': ['activation-leaflet', 'Activation leaflet'],
      'CMP-MAG-005': ['lid-magnet', 'Lid magnet'],
    };
    for (const [id, [key, name]] of Object.entries(want)) {
      const p = partFor(id);
      expect([id, p.key, p.name]).toEqual([id, key, name]);
      if (key !== 'lid-magnet') expect(p.img).toBe(`/img/parts/${key}.webp`);
    }
  });
  it('magnet has no image', () => expect(partFor('CMP-MAG-005').img).toBeNull());
  it('falls back to keywords, case-insensitively', () => {
    expect(partFor('Game Card Case (clear)').key).toBe('clear-case');
    expect(partFor('GAME CARDS 128 GB').key).toBe('game-card');
    expect(partFor('Art Book (96 p hardcover)').key).toBe('art-book');
    expect(partFor("Statue 'The Getaway'").key).toBe('statue');
    expect(partFor('City Map Poster (folded)').key).toBe('city-map-poster');
    expect(partFor('Steel Case').key).toBe('steel-case');
    expect(partFor('Cover Sleeve GH6').key).toBe('cover-sleeve');
    expect(partFor('Activation Code Leaflet').key).toBe('activation-leaflet');
    expect(partFor('Collector leaflet').key).toBe('leaflet');
    expect(partFor('lid magnets').key).toBe('lid-magnet');
    expect(partFor("Collector's Box (rigid, magnetic lid)").key).toBe('collectors-box');
  });
  it('unknown text gives a safe generic part', () => {
    const p = partFor('Widget 9');
    expect([p.key, p.name, p.img]).toEqual(['generic', 'Widget 9', null]);
    expect(partFor(undefined).key).toBe('generic');
  });
  it('BOM lists match the layout', () => {
    expect(BOM_STANDARD.length).toBe(4);
    expect(BOM_COLLECTORS.length).toBe(8);
    expect(BOM_COLLECTORS.find((b) => b.id === 'CMP-MAG-005')?.qty).toBe(4);
  });
});

describe('PartImage', () => {
  it('shows the picture with the part name as alt text', () => {
    render(<PartImage part={partFor('CMP-GAM-008')} size={48} />);
    const img = screen.getByAltText('Art book');
    expect(img.getAttribute('src')).toBe('/img/parts/art-book.webp');
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('width')).toBeTruthy();
  });
  it('uses the icon tile when there is no picture', () => {
    const { container } = render(<PartImage part={partFor('CMP-MAG-005')} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('part-icon').getAttribute('aria-label')).toBe('Lid magnet');
  });
  it('falls back to the icon when the picture fails', () => {
    const { container } = render(<PartImage part={partFor('CMP-GAM-010')} />);
    fireEvent.error(screen.getByAltText('Statue'));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('part-icon')).toBeTruthy();
  });
});

describe('Parts BOM row', () => {
  const o: Overview = { issues: [{ id: 'a', title: 'Game cards: x', shortage: 6800 }, { id: 'b', title: 'Art books: y', shortage: 0 }, { id: 'c', title: 'Statues: z' }] };
  it("collector's lists 8 cards incl. Lid magnet x4 with an icon and no img", () => {
    render(<BomSection o={{}} />);
    const cards = screen.getAllByTestId('bom-card');
    expect(cards.length).toBe(8);
    const mag = cards.find((c) => c.textContent?.includes('Lid magnet'))!;
    expect(mag.textContent).toContain('x4');
    expect(mag.querySelector('img')).toBeNull();
    expect(within(mag).getByTestId('part-icon')).toBeTruthy();
    expect(screen.getByAltText("Collector's edition")).toBeTruthy();
    expect(screen.queryAllByTestId('part-chip').length).toBe(0);
  });
  it('standard lists 4 cards and its box', () => {
    render(<BomSection o={{}} />);
    fireEvent.click(screen.getByText('Standard'));
    expect(screen.getAllByTestId('bom-card').length).toBe(4);
    expect(screen.getByAltText('Standard edition')).toBeTruthy();
  });
  it('chips only on parts that match an issue, and click selects the case', () => {
    const onSelect = vi.fn();
    render(<BomSection o={o} onSelect={onSelect} />);
    const cards = screen.getAllByTestId('bom-card');
    const withChip = cards.filter((c) => within(c).queryByTestId('part-chip')).map((c) => c.getAttribute('data-part'));
    expect(withChip).toEqual(['game-card', 'art-book', 'statue']);
    const game = cards.find((c) => c.getAttribute('data-part') === 'game-card')!;
    expect(game.textContent).toContain('Short');
    expect(game.textContent).toContain('6,800');
    fireEvent.click(game);
    expect(onSelect).toHaveBeenCalledWith('a');
  });
});

describe('lane row image', () => {
  it('shows the part image beside the material', () => {
    const t: Transport = { lanes: [{ supplier: 'Acme', material: 'Game Card 128 GB Grand Heist 6', modes: [{ mode: 'air', feasible: true }] }] };
    render(<TransportSection t={t} />);
    expect(screen.getByAltText('Game card').getAttribute('src')).toBe('/img/parts/game-card.webp');
  });
});
