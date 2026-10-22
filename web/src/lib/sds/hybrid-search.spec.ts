import {
  getAllAlbums,
  getAllSpaces,
  getAllTags,
  getMapMarkers,
  getSharedSpaceAlbums,
  searchAssets,
  searchSmart,
  type AssetResponseDto,
  type MetadataSearchDto,
} from '@immich/sdk';
import {
  clearSearchCatalogs,
  fuseRankings,
  fuzzyScore,
  rankMatches,
  RRF_K,
  SDS_SEARCH_WEIGHTS,
  searchAll,
  searchSmartOrAll,
  searchWords,
} from './hybrid-search';
import { clearPlaceCache } from './place-search';

vi.mock('@immich/sdk', async () => ({
  ...(await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk')),
  getAllAlbums: vi.fn(),
  getAllSpaces: vi.fn(),
  getAllTags: vi.fn(),
  getMapMarkers: vi.fn(),
  getSharedSpaceAlbums: vi.fn(),
  searchAssets: vi.fn(),
  searchSmart: vi.fn(),
}));

const asset = (id: string, localDateTime = '2026-01-01T00:00:00') => ({ id, localDateTime }) as AssetResponseDto;
const page = (ids: string[], nextPage: string | null = null) =>
  ({ assets: { items: ids.map((id) => asset(id)), nextPage } }) as never;

describe('SDS Alles search', () => {
  describe('fuzzyScore', () => {
    const score = (query: string, name: string) => fuzzyScore(searchWords(query), name);

    it('matches the query inside a longer name, ignoring case and accents', () => {
      expect(score('wezep', 'Project 26801558 Bovenheigraaf 162 8091 BZ Wezep')).toBe(1);
      expect(score('fryslan', 'Fryslân')).toBe(1);
    });

    it('matches a name that is part of a longer query', () => {
      expect(score('dakkapel zwolle', 'Zwolle')).toBe(1);
    });

    it('finds a word inside a compound word, but not the other way round', () => {
      expect(score('goot', 'Dakgoot')).toBe(1);
      expect(score('dakkapel', 'Dak')).toBeLessThan(0.5);
    });

    it('tolerates a typo', () => {
      expect(score('dakapel', 'Dakkapel')).toBeGreaterThanOrEqual(0.5);
    });

    it('scores a half match at 0.5 and an unrelated name low', () => {
      expect(score('dakkapel zwolle', 'Dakkapel Wezep')).toBe(0.5);
      expect(score('castricum', 'Roofit Solar')).toBeLessThan(0.5);
    });
  });

  it('rankMatches keeps matches from MIN_MATCH up, best first, equal scores in one group', () => {
    const names = ['Dakkapel Zwolle', 'Dakkapel Wezep', 'Zwolle', 'Roofit Solar'];
    expect(rankMatches(names, (name) => fuzzyScore(searchWords('dakkapel zwolle'), name))).toEqual([
      ['Dakkapel Zwolle', 'Zwolle'],
      ['Dakkapel Wezep'],
    ]);
  });

  describe('fuseRankings', () => {
    it('scores weight / (k + rank) summed over the sources', () => {
      const weights = { ...SDS_SEARCH_WEIGHTS, smart: 1, album: 3 };
      expect(
        fuseRankings(
          [
            { source: 'smart', groups: [['a'], ['b'], ['c']] },
            { source: 'album', groups: [['c']] },
          ],
          weights,
        ),
      ).toEqual(['c', 'a', 'b']);
      expect(3 / (RRF_K + 1) + 1 / (RRF_K + 3)).toBeGreaterThan(1 / (RRF_K + 1));
    });

    it('gives every photo of a group the same rank, and lets smart order the ties', () => {
      expect(
        fuseRankings([
          { source: 'smart', groups: [['z'], ['y']] },
          { source: 'album', groups: [['x', 'y', 'z']] },
        ]),
      ).toEqual(['z', 'y', 'x']);
    });

    it('counts a photo once per source, at its best rank', () => {
      expect(
        fuseRankings([
          { source: 'album', groups: [['a'], ['a', 'b']] },
          { source: 'tag', groups: [['b']] },
        ]),
      ).toEqual(['b', 'a']);
    });
  });

  describe('searchAll', () => {
    beforeEach(() => {
      clearSearchCatalogs();
      clearPlaceCache();
      vi.mocked(getAllAlbums).mockResolvedValue([]);
      vi.mocked(getAllSpaces).mockResolvedValue([{ id: 'space-sds' }] as never);
      // made by another user, linked to the SDS space: only the space lists it
      vi.mocked(getSharedSpaceAlbums).mockResolvedValue([
        { id: 'album-wezep', albumName: 'Project 26801558', description: 'Bovenheigraaf 162 8091 BZ Wezep' },
      ] as never);
      vi.mocked(getAllTags).mockResolvedValue([{ id: 'tag-dakkapel', name: 'Dakkapel' }] as never);
      vi.mocked(getMapMarkers).mockResolvedValue([{ city: 'Hattem', state: 'Gelderland', lat: 52, lon: 6 }] as never);
      vi.mocked(searchSmart).mockResolvedValue(page(['smart-1', 'in-album-2']));
      vi.mocked(searchAssets).mockImplementation(
        ({ metadataSearchDto: dto }: { metadataSearchDto: MetadataSearchDto }) => {
          if (dto.albumIds?.includes('album-wezep')) {
            return Promise.resolve(page(['in-album-1', 'in-album-2']));
          }
          if (dto.tagIds?.includes('tag-dakkapel')) {
            return Promise.resolve(page(['tagged']));
          }
          if (dto.city === 'Hattem') {
            return Promise.resolve(page(['in-hattem']));
          }
          return Promise.resolve(page([]));
        },
      );
    });

    it('finds the photos of a space album by its description, ranked above smart-only results', async () => {
      const { items } = await searchAll('wezep');
      expect(items.map(({ id }) => id)).toEqual(['in-album-2', 'in-album-1', 'smart-1']);
      expect(getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 'space-sds' });
    });

    it('opens tags and places per query word, inside the given scope', async () => {
      const { items } = await searchAll('dakkapel hattem', { base: { withSharedSpaces: true } });
      expect(items.map(({ id }) => id)).toEqual(['tagged', 'in-hattem', 'smart-1', 'in-album-2']);
      expect(searchAssets).toHaveBeenCalledWith(
        { metadataSearchDto: expect.objectContaining({ tagIds: ['tag-dakkapel'], withSharedSpaces: true }) },
        expect.anything(),
      );
    });

    it('ranks file names that contain more of the query words higher', async () => {
      vi.mocked(searchAssets).mockImplementation(
        ({ metadataSearchDto: dto }: { metadataSearchDto: MetadataSearchDto }) =>
          Promise.resolve(
            page(dto.originalFileName === 'img' ? ['img-other', 'img-3938'] : dto.originalFileName ? ['img-3938'] : []),
          ),
      );
      vi.mocked(searchSmart).mockResolvedValue(page([]));
      const { items } = await searchAll('IMG_3938');
      expect(items.map(({ id }) => id)).toEqual(['img-3938', 'img-other']);
    });

    it('still answers when smart search fails, and fails only when every source fails', async () => {
      vi.mocked(searchSmart).mockRejectedValue(new Error('ML down'));
      await expect(searchAll('wezep')).resolves.toMatchObject({ items: [{ id: 'in-album-1' }, { id: 'in-album-2' }] });

      vi.mocked(searchAssets).mockRejectedValue(new Error('server down'));
      vi.mocked(getAllTags).mockRejectedValue(new Error('server down'));
      clearSearchCatalogs();
      await expect(searchAll('wezep')).rejects.toThrow();
    });

    it('follows a date sort from the filter panel', async () => {
      vi.mocked(searchSmart).mockResolvedValue({
        assets: { items: [asset('new', '2026-05-01T00:00:00'), asset('old', '2020-05-01T00:00:00')], nextPage: null },
      } as never);
      const { items } = await searchAll('roofit', { base: { order: 'asc' as never } });
      expect(items.map(({ id }) => id)).toEqual(['old', 'new']);
    });
  });

  describe('searchSmartOrAll', () => {
    beforeEach(() => {
      clearSearchCatalogs();
      vi.mocked(getAllAlbums).mockResolvedValue([]);
      vi.mocked(getAllSpaces).mockResolvedValue([]);
      vi.mocked(getAllTags).mockResolvedValue([]);
      vi.mocked(getMapMarkers).mockResolvedValue([]);
      vi.mocked(searchAssets).mockResolvedValue(page([]));
      vi.mocked(searchSmart).mockResolvedValue(page(['smart-1'], '2'));
    });

    it('is plain smart search outside the Alles mode and for later pages', async () => {
      await searchSmartOrAll('smart', { smartSearchDto: { query: 'dak', page: 1 } });
      await searchSmartOrAll('all', { smartSearchDto: { query: 'dak', page: 2 } });
      expect(vi.mocked(searchSmart).mock.calls.map(([args]) => args)).toEqual([
        { smartSearchDto: { query: 'dak', page: 1 } },
        { smartSearchDto: { query: 'dak', page: 2 } },
      ]);
      expect(searchAssets).not.toHaveBeenCalled();
    });

    it('fuses page 1 in the Alles mode and keeps smart search paging after it', async () => {
      const { assets } = await searchSmartOrAll('all', {
        smartSearchDto: { query: 'dak', language: 'nl', page: 1, size: 100 },
      });
      expect(assets).toMatchObject({ items: [{ id: 'smart-1' }], nextPage: '2' });
      expect(searchSmart).toHaveBeenCalledWith(
        { smartSearchDto: { query: 'dak', language: 'nl', size: 100 } },
        expect.anything(),
      );
    });
  });

  it('makes Alles the default once per browser', async () => {
    const { sdsDefaultSearchMode } = await vi.importActual<typeof import('./hybrid-search')>('./hybrid-search');
    localStorage.clear();
    localStorage.setItem('searchQueryType', 'smart');
    sdsDefaultSearchMode();
    expect(localStorage.getItem('searchQueryType')).toBe('all');

    localStorage.setItem('searchQueryType', 'ocr');
    sdsDefaultSearchMode();
    expect(localStorage.getItem('searchQueryType')).toBe('ocr');
  });
});
