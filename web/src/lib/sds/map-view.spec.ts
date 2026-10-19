import type { Map } from 'maplibre-gl';
import { applySdsInitialView, SDS_MAP_VIEW } from './map-view';

describe('SDS initial map view', () => {
  const map = { jumpTo: vi.fn() };

  beforeEach(() => {
    map.jumpTo.mockReset();
    location.hash = '';
  });

  it('opens on the Netherlands when the map has no view of its own', () => {
    applySdsInitialView(map as unknown as Map, { hash: true });
    expect(map.jumpTo).toHaveBeenCalledWith(SDS_MAP_VIEW);
  });

  it('keeps the view from the URL hash', () => {
    location.hash = '#12/52.5/6.1';
    applySdsInitialView(map as unknown as Map, { hash: true });
    expect(map.jumpTo).not.toHaveBeenCalled();
  });

  it('keeps a view the caller asked for', () => {
    applySdsInitialView(map as unknown as Map, { hash: false, center: [6, 52], zoom: 14 });
    applySdsInitialView(map as unknown as Map, { hash: false, bounds: [5, 51, 7, 53] });
    expect(map.jumpTo).not.toHaveBeenCalled();
  });
});
