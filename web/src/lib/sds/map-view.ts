import type { LngLatBoundsLike, LngLatLike, Map } from 'maplibre-gl';

// SDS: Gallery opens the map on the whole world when it has no view of its own, because the /map page
// loads its markers after the map is created, so the "fit to markers" bounds never apply. Open on the
// Netherlands instead. To pick another view, move the map and copy the URL hash: #zoom/lat/lng.
export const SDS_MAP_VIEW = { center: [5.774, 52.217] as LngLatLike, zoom: 6.67 };

type InitialView = { hash: boolean; center?: LngLatLike; zoom?: number; bounds?: LngLatBoundsLike };

export const applySdsInitialView = (map: Map, { hash, center, zoom, bounds }: InitialView) => {
  if ((hash && location.hash) || center || zoom !== undefined || bounds) {
    return;
  }
  map.jumpTo(SDS_MAP_VIEW);
};
