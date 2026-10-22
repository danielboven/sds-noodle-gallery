import { getMapMarkers, type MapMarkerResponseDto, type PlacesResponseDto } from '@immich/sdk';
import { normalizeSearchString } from '$lib/utils/string-utils';

// SDS: Gallery's search palette offered places from the GeoNames world list (500+ inhabitants), so it
// showed places without photos (Zwolle, Louisiana) and missed small villages on our photos (Reeve).
// Its Places now come from the place names on the photos themselves, read from the map markers (the
// same call the map page makes) and kept for a few minutes, so typing only filters in the browser.
const CACHE_MS = 5 * 60_000;

type Place = PlacesResponseDto & { photos: number; search: string };

let cache: { loadedAt: number; places: Promise<Place[]> } | undefined;

const toPlaces = (markers: MapMarkerResponseDto[]) => {
  const places = new Map<string, Place>();
  for (const { city, state, lat, lon } of markers) {
    if (!city) {
      continue;
    }
    const key = `${city}|${state ?? ''}`;
    const place = places.get(key) ?? {
      name: city,
      admin1name: state ?? undefined,
      latitude: 0,
      longitude: 0,
      photos: 0,
      search: normalizeSearchString(city),
    };
    // running average of the photos' positions, so the map can jump to the place
    place.photos++;
    place.latitude += (lat - place.latitude) / place.photos;
    place.longitude += (lon - place.longitude) / place.photos;
    places.set(key, place);
  }
  return [...places.values()];
};

export const loadPhotoPlaces = () => {
  if (!cache || Date.now() - cache.loadedAt > CACHE_MS) {
    const places = getMapMarkers({ withSharedSpaces: true }).then(toPlaces);
    places.catch(() => (cache = undefined));
    cache = { loadedAt: Date.now(), places };
  }
  return cache.places;
};

export const searchPlacesWithPhotos = async (query: string, { signal }: { signal?: AbortSignal } = {}) => {
  const places = await loadPhotoPlaces();
  signal?.throwIfAborted();
  const search = normalizeSearchString(query);
  const startsWith = (place: Place) => Number(place.search.startsWith(search));
  return places
    .filter((place) => place.search.includes(search))
    .sort((a, b) => startsWith(b) - startsWith(a) || b.photos - a.photos)
    .map(({ name, admin1name, latitude, longitude }): PlacesResponseDto => ({ name, admin1name, latitude, longitude }));
};

export const clearPlaceCache = () => (cache = undefined);
