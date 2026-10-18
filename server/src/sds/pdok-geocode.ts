import type { GeoPoint } from 'src/repositories/map.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';

// SDS: Dutch place names from PDOK's Locatieserver (Kadaster/BAG) instead of Gallery's GeoNames lookup.
// GeoNames picks the nearest place with 500+ inhabitants, measured to its centre point; PDOK returns
// the BAG woonplaats the point lies in (Wezep, not the gemeente Oldebroek it belongs to).
//
// Turned on with SDS_PDOK_GEOCODING=true. PDOK only knows the Netherlands: a point outside every Dutch
// woonplaats (abroad, at sea) or any failure (timeout, HTTP error, odd answer) returns null, and Gallery's
// own GeoNames lookup runs as before.
const PDOK_REVERSE_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse';
const PDOK_TIMEOUT_MS = 2000;

export type PdokPlace = { city: string; state: string | null };

type PdokResponse = {
  response?: { docs?: Array<{ woonplaatsnaam?: string; provincienaam?: string; afstand?: number }> };
};

export const isPdokGeocodingEnabled = () => process.env.SDS_PDOK_GEOCODING === 'true';

export const pdokReverseGeocode = async (point: GeoPoint, logger: LoggingRepository): Promise<PdokPlace | null> => {
  if (!isPdokGeocodingEnabled()) {
    return null;
  }

  const url = new URL(PDOK_REVERSE_URL);
  url.search = new URLSearchParams({
    lat: String(point.latitude),
    lon: String(point.longitude),
    type: 'woonplaats',
    rows: '1',
    fl: 'woonplaatsnaam,provincienaam,afstand',
  }).toString();

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PDOK_TIMEOUT_MS) });
    if (!response.ok) {
      logger.warn(`PDOK reverse geocoding failed with HTTP ${response.status}, falling back to GeoNames`);
      return null;
    }

    const place = ((await response.json()) as PdokResponse).response?.docs?.[0];
    // afstand 0 means the point lies inside this woonplaats; anything else is the nearest Dutch
    // woonplaats to a point outside all of them (abroad, at sea), so GeoNames decides.
    if (!place?.woonplaatsnaam || place.afstand !== 0) {
      return null;
    }

    return { city: place.woonplaatsnaam, state: place.provincienaam ?? null };
  } catch (error) {
    logger.warn(`PDOK reverse geocoding unavailable (${error}), falling back to GeoNames`);
    return null;
  }
};
