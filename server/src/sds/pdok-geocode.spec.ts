import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { pdokReverseGeocode } from 'src/sds/pdok-geocode.js';

const wezep = { latitude: 52.4614, longitude: 6.0026 };

const answer = (docs: unknown[]) => new Response(JSON.stringify({ response: { numFound: docs.length, docs } }));

describe('SDS PDOK reverse geocoding', () => {
  const logger = { warn: vi.fn() } as unknown as LoggingRepository;
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.SDS_PDOK_GEOCODING = 'true';
    fetchMock = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    delete process.env.SDS_PDOK_GEOCODING;
    fetchMock.mockRestore();
    vi.mocked(logger.warn).mockReset();
  });

  it('returns the woonplaats the point lies in, not the gemeente', async () => {
    fetchMock.mockResolvedValue(answer([{ woonplaatsnaam: 'Wezep', provincienaam: 'Gelderland', afstand: 0 }]));

    await expect(pdokReverseGeocode(wezep, logger)).resolves.toEqual({ city: 'Wezep', state: 'Gelderland' });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lat: '52.4614',
      lon: '6.0026',
      type: 'woonplaats',
      rows: '1',
      fl: 'woonplaatsnaam,provincienaam,afstand',
    });
  });

  it('falls back for a point outside every Dutch woonplaats (PDOK returns the nearest one)', async () => {
    fetchMock.mockResolvedValue(answer([{ woonplaatsnaam: 'Eede', provincienaam: 'Zeeland', afstand: 263_000 }]));
    await expect(pdokReverseGeocode({ latitude: 48.8566, longitude: 2.3522 }, logger)).resolves.toBeNull();
  });

  it('falls back on an empty or malformed answer', async () => {
    fetchMock.mockResolvedValueOnce(answer([]));
    await expect(pdokReverseGeocode(wezep, logger)).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(new Response('{"unexpected":true}'));
    await expect(pdokReverseGeocode(wezep, logger)).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(new Response('not json'));
    await expect(pdokReverseGeocode(wezep, logger)).resolves.toBeNull();
  });

  it('falls back on an HTTP error', async () => {
    fetchMock.mockResolvedValue(new Response('busy', { status: 503 }));
    await expect(pdokReverseGeocode(wezep, logger)).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
  });

  it('falls back when PDOK is unreachable or too slow', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    await expect(pdokReverseGeocode(wezep, logger)).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('falling back to GeoNames'));
  });

  it('stops waiting after the timeout', async () => {
    fetchMock.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))),
    );
    const started = Date.now();
    await expect(pdokReverseGeocode(wezep, logger)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('does nothing unless SDS_PDOK_GEOCODING=true', async () => {
    delete process.env.SDS_PDOK_GEOCODING;
    await expect(pdokReverseGeocode(wezep, logger)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
