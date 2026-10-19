import { SDS_MAP_VIEW, sdsInitialView } from './map-view';

describe('SDS initial map view', () => {
  it('starts on the Netherlands when the map has no view of its own', () => {
    expect(sdsInitialView({})).toEqual(SDS_MAP_VIEW);
  });

  it('keeps a view the caller asked for', () => {
    expect(sdsInitialView({ center: [6, 52], zoom: 14 })).toEqual({});
    expect(sdsInitialView({ zoom: 0 })).toEqual({});
    expect(sdsInitialView({ bounds: [5, 51, 7, 53] })).toEqual({});
  });
});
