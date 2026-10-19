import type { LngLatBoundsLike, LngLatLike } from 'maplibre-gl';

// SDS: Gallery opens the map on the whole world when it has no view of its own, because the /map page
// loads its markers after the map is created, so the "fit to markers" bounds never apply. Start on the
// Netherlands instead. A view in the URL hash still wins: svelte-maplibre reads it before creating the
// map. To pick another view, move the map and copy the URL hash: #zoom/lat/lng.
export const SDS_MAP_VIEW = { center: [5.774, 52.217] as LngLatLike, zoom: 6.67 };

type Caller = { center?: LngLatLike; zoom?: number; bounds?: LngLatBoundsLike };

export const sdsInitialView = ({ center, zoom, bounds }: Caller): Partial<typeof SDS_MAP_VIEW> =>
  center || zoom !== undefined || bounds ? {} : SDS_MAP_VIEW;
