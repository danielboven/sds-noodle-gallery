import { getMapMarkers, type MapMarkerResponseDto } from '@immich/sdk';
import { clearPlaceCache, searchPlacesWithPhotos } from './place-search';

vi.mock('@immich/sdk', async () => ({
  ...(await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk')),
  getMapMarkers: vi.fn(),
}));

const marker = (city: string | null, state: string | null, lat: number, lon: number) =>
  ({ id: `${city}-${lat}`, city, state, country: 'Netherlands', lat, lon }) as MapMarkerResponseDto;

describe('SDS search palette places', () => {
  beforeEach(() => {
    clearPlaceCache();
    vi.mocked(getMapMarkers).mockResolvedValue([
      marker('Zwolle', 'Overijssel', 52.5, 6.08),
      marker('Zwolle', 'Overijssel', 52.52, 6.1),
      marker('Reeve', 'Overijssel', 52.54, 5.87),
      marker('Oud-Zwolle', 'Gelderland', 52.1, 5.9),
      marker('Oud-Zwolle', 'Gelderland', 52.1, 5.9),
      marker('Oud-Zwolle', 'Gelderland', 52.1, 5.9),
      marker('Hückeswagen', 'Nordrhein-Westfalen', 51.14, 7.34),
      marker(null, null, 0, 0),
    ]);
  });

  it('finds small villages from the photos, once per place, at the average position', async () => {
    await expect(searchPlacesWithPhotos('reeve')).resolves.toEqual([
      { name: 'Reeve', admin1name: 'Overijssel', latitude: 52.54, longitude: 5.87 },
    ]);
    const [zwolle] = await searchPlacesWithPhotos('Zwolle');
    expect(zwolle.latitude).toBeCloseTo(52.51);
    expect(zwolle.longitude).toBeCloseTo(6.09);
  });

  it('puts names starting with the query first, then places with more photos', async () => {
    const places = await searchPlacesWithPhotos('zwol');
    expect(places.map(({ name }) => name)).toEqual(['Zwolle', 'Oud-Zwolle']);
  });

  it('ignores case and accents', async () => {
    await expect(searchPlacesWithPhotos('huckes')).resolves.toHaveLength(1);
  });

  it('loads the markers once while typing', async () => {
    await searchPlacesWithPhotos('zw');
    await searchPlacesWithPhotos('zwo');
    expect(getMapMarkers).toHaveBeenCalledTimes(1);
    expect(getMapMarkers).toHaveBeenCalledWith({ withSharedSpaces: true });
  });

  it('tries again after a failed load', async () => {
    vi.mocked(getMapMarkers).mockRejectedValueOnce(new Error('offline'));
    await expect(searchPlacesWithPhotos('reeve')).rejects.toThrow('offline');
    await expect(searchPlacesWithPhotos('reeve')).resolves.toHaveLength(1);
  });
});
