import { Kysely } from 'kysely';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MapRepository } from 'src/repositories/map.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { DB } from 'src/schema/index.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;
const wezep = { latitude: 52.4614, longitude: 6.0026 };

const setup = async () => {
  const geodata = await mkdtemp(join(tmpdir(), 'sds-geodata-'));
  await writeFile(
    join(geodata, 'countryInfo.txt'),
    '#ISO\tISO3\tISO-Numeric\tfips\tCountry\nNL\tNLD\t528\tNL\tNetherlands\n',
  );

  const config = {
    getEnv: () => ({ resourcePaths: { geodata: { countryInfo: join(geodata, 'countryInfo.txt') } } }),
  } as unknown as ConfigRepository;
  const logger = { setContext: vi.fn(), log: vi.fn(), debug: vi.fn(), warn: vi.fn(), verboseFn: vi.fn() };
  const map = new MapRepository(
    config,
    {} as SystemMetadataRepository,
    logger as unknown as LoggingRepository,
    defaultDatabase,
  );

  // GeoNames' nearest place with 500+ inhabitants to Wezep's centre is the village Oldebroek
  await defaultDatabase
    .insertInto('geodata_places')
    .values({
      id: 2_749_543,
      name: 'Oldebroek',
      latitude: 52.445,
      longitude: 5.9014,
      countryCode: 'NL',
      admin1Code: '03',
      admin1Name: 'Gelderland',
      admin2Code: null,
      admin2Name: null,
      alternateNames: null,
      modificationDate: '2024-01-01',
    })
    .onConflict((oc) => oc.doNothing())
    .execute();

  return map;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('SDS PDOK reverse geocoding in MapRepository', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    delete process.env.SDS_PDOK_GEOCODING;
    fetchMock.mockRestore();
  });

  it('uses the PDOK woonplaats when enabled', async () => {
    const map = await setup();
    process.env.SDS_PDOK_GEOCODING = 'true';
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          response: { docs: [{ woonplaatsnaam: 'Wezep', provincienaam: 'Gelderland', afstand: 0 }] },
        }),
      ),
    );

    await expect(map.reverseGeocode(wezep)).resolves.toEqual({
      country: 'Netherlands',
      state: 'Gelderland',
      city: 'Wezep',
    });
  });

  it('falls back to GeoNames when PDOK fails', async () => {
    const map = await setup();
    process.env.SDS_PDOK_GEOCODING = 'true';
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(map.reverseGeocode(wezep)).resolves.toEqual({
      country: 'Netherlands',
      state: 'Gelderland',
      city: 'Oldebroek',
    });
  });

  it('keeps Gallery behaviour without SDS_PDOK_GEOCODING', async () => {
    const map = await setup();

    await expect(map.reverseGeocode(wezep)).resolves.toEqual({
      country: 'Netherlands',
      state: 'Gelderland',
      city: 'Oldebroek',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
