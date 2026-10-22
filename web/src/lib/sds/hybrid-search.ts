import {
  getAllAlbums,
  getAllSpaces,
  getAllTags,
  getSharedSpaceAlbums,
  searchAssets,
  searchSmart,
  type AssetResponseDto,
  type MetadataSearchDto,
  type SmartSearchDto,
} from '@immich/sdk';
import type { ProviderStatus, SearchMode } from '$lib/managers/global-search-manager.svelte';
import { loadPhotoPlaces } from '$lib/sds/place-search';
import { normalizeSearchString } from '$lib/utils/string-utils';

// SDS: the "Alles" search mode. Smart search (CLIP) only sees what is in the image, so it misses the names
// people gave things: albums ("Project 26801558", with the address in the description), tags, places and
// renamed files. "Alles" asks each of those sources for its own ranked list and fuses the lists with
// weighted Reciprocal Rank Fusion (Cormack et al. 2009): score(photo) = Σ weight / (RRF_K + rank). RRF only
// uses ranks, so CLIP distances and text matches never have to be put on one scale.
// Weights and the reasoning behind them: SDS-SEARCH.md at the repo root. Keep that file in sync.
export const SDS_SEARCH_WEIGHTS = {
  album: 3,
  tag: 2,
  place: 1.5,
  smart: 1,
  fileName: 1,
  description: 0.5,
  ocr: 0.5,
} as const;

export type SearchSource = keyof typeof SDS_SEARCH_WEIGHTS;

/** The constant from the RRF paper; it flattens the gap between rank 1 and rank 2. */
export const RRF_K = 60;
/** A name counts as a match from this fuzzy score (0..1) up. */
export const MIN_MATCH = 0.5;
/** At most this many query words are sent to the text fields, and this many albums/tags/places are opened. */
const MAX_WORDS = 3;
const MAX_SETS = 5;
const CACHE_MS = 5 * 60_000;

export const SDS_ALL_MODE = 'all' satisfies SearchMode;

/** One source's result: ranked groups of asset ids. All ids in a group tie, e.g. every photo of one album. */
export type Ranking = { source: SearchSource; groups: string[][] };

// ---- fuzzy matching (mirrors pg_trgm's trigram similarity, in the browser) ----

export const searchWords = (text: string) =>
  normalizeSearchString(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2);

const trigrams = (word: string) => {
  const padded = `  ${word} `;
  const result = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    result.add(padded.slice(i, i + 3));
  }
  return result;
};

/** How well a query word matches a word of a name: 1 when the name word contains it ("goot" in "dakgoot"). */
const wordSimilarity = (queryWord: string, nameWord: string) => {
  if (queryWord.length >= 3 && nameWord.includes(queryWord)) {
    return 1;
  }
  const a = trigrams(queryWord);
  const b = trigrams(nameWord);
  let shared = 0;
  for (const trigram of a) {
    shared += Number(b.has(trigram));
  }
  return shared / (a.size + b.size - shared);
};

const coverage = (words: string[], against: string[], similarity: (word: string, other: string) => number) =>
  words.reduce((sum, word) => sum + Math.max(...against.map((other) => similarity(word, other))), 0) / words.length;

/**
 * Fuzzy score (0..1) of a name for the query words: the better of "how much of the query is in the name"
 * (query "zwolle" vs album "Dakkapel Zwolle") and "how much of the name is in the query" (tag "Zwolle" vs
 * query "dakkapel zwolle").
 */
export const fuzzyScore = (queryWords: string[], name: string | undefined | null) => {
  const nameWords = searchWords(name ?? '');
  if (queryWords.length === 0 || nameWords.length === 0) {
    return 0;
  }
  return Math.max(
    coverage(queryWords, nameWords, wordSimilarity),
    coverage(nameWords, queryWords, (nameWord, queryWord) => wordSimilarity(queryWord, nameWord)),
  );
};

/** The names that match, best first, grouped so equally good matches share a rank. */
export const rankMatches = <T>(items: T[], score: (item: T) => number, limit = MAX_SETS) => {
  const matches = items
    .map((item) => ({ item, score: Math.round(score(item) * 100) / 100 }))
    .filter((match) => match.score >= MIN_MATCH)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const groups: T[][] = [];
  let previous: number | undefined;
  for (const match of matches) {
    if (match.score === previous) {
      groups.at(-1)!.push(match.item);
    } else {
      groups.push([match.item]);
      previous = match.score;
    }
  }
  return groups;
};

// ---- fusion ----

/**
 * Weighted Reciprocal Rank Fusion. Ranks start at 1 and count groups, not photos, so a whole album shares
 * its album's rank. A photo counts once per source, at its best rank there. Equal scores keep the order in
 * which the rankings list them, which is why smart search goes first: it orders the photos inside an album.
 */
export const fuseRankings = (rankings: Ranking[], weights = SDS_SEARCH_WEIGHTS, k = RRF_K) => {
  const scores = new Map<string, number>();
  for (const { source, groups } of rankings) {
    const seen = new Set<string>();
    for (const [index, ids] of groups.entries()) {
      for (const id of ids) {
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        scores.set(id, (scores.get(id) ?? 0) + weights[source] / (k + index + 1));
      }
    }
  }
  return [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => id);
};

// ---- catalogs: album, tag and place names, loaded once per few minutes and matched in the browser ----

type AlbumName = { id: string; albumName: string; description: string };

const cached = <T>(load: () => Promise<T>) => {
  let cache: { loadedAt: number; value: Promise<T> } | undefined;
  return {
    get: () => {
      if (!cache || Date.now() - cache.loadedAt > CACHE_MS) {
        const value = load();
        value.catch(() => (cache = undefined));
        cache = { loadedAt: Date.now(), value };
      }
      return cache.value;
    },
    clear: () => (cache = undefined),
  };
};

// The user's own and shared albums, plus every album linked to a space the user is a member of: SDS albums
// live in the SDS space and were mostly made by someone else, so they are not in GET /albums.
const albums = cached(async () => {
  const [own, spaces] = await Promise.all([getAllAlbums({}), getAllSpaces()]);
  const spaceAlbums = await Promise.all(spaces.map(({ id }) => getSharedSpaceAlbums({ id })));
  const byId = new Map<string, AlbumName>();
  for (const { id, albumName, description } of [...own, ...spaceAlbums.flat()]) {
    byId.set(id, { id, albumName, description });
  }
  return [...byId.values()];
});

const tags = cached(() => getAllTags());

export const clearSearchCatalogs = () => {
  albums.clear();
  tags.clear();
};

// ---- sources ----

/** Filters shared by every source: the palette's scope, or the results page's filter panel. */
export type SearchBase = Omit<SmartSearchDto, 'query' | 'queryAssetId' | 'language' | 'page' | 'size'>;

type SourceContext = {
  words: string[];
  base: SearchBase;
  size: number;
  smartSize: number;
  language?: string;
  signal?: AbortSignal;
};
/** `undefined`: the source had nothing to look up (no album name matched), so it neither answered nor failed. */
type SourceResult = { ranking: Ranking; assets: AssetResponseDto[]; nextPage?: string | null } | undefined;

const assetsFor = async (dto: MetadataSearchDto, { base, size, signal }: SourceContext) => {
  const { assets } = await searchAssets({ metadataSearchDto: { ...base, ...dto, size } }, { signal });
  return assets.items;
};

/** Photos of each matched set (album, tag, place); the photos of one set share its rank. */
const setRanking = async <T>(
  source: SearchSource,
  groups: T[][],
  filter: (item: T) => MetadataSearchDto,
  context: SourceContext,
): Promise<SourceResult> => {
  if (groups.length === 0) {
    return undefined;
  }
  const perSet = await Promise.all(
    groups.map((group) => Promise.all(group.map((item) => assetsFor(filter(item), context)))),
  );
  const assets = perSet.map((sets) => sets.flat());
  return { ranking: { source, groups: assets.map((group) => group.map(({ id }) => id)) }, assets: assets.flat() };
};

/** One search per query word (the server matches a substring); photos matching more words rank higher. */
const wordRanking = async (
  source: SearchSource,
  field: 'originalFileName' | 'description',
  context: SourceContext,
): Promise<SourceResult> => {
  const words = context.words.filter((word) => word.length >= 3).slice(0, MAX_WORDS);
  if (words.length === 0) {
    return undefined;
  }
  const perWord = await Promise.all(words.map((word) => assetsFor({ [field]: word }, context)));
  const hits = new Map<string, number>();
  for (const { id } of perWord.flat()) {
    hits.set(id, (hits.get(id) ?? 0) + 1);
  }
  const groups = Array.from({ length: words.length }, (_, index) =>
    [...hits].filter(([, count]) => count === words.length - index).map(([id]) => id),
  ).filter((group) => group.length > 0);
  return { ranking: { source, groups }, assets: perWord.flat() };
};

type SourceRun = (query: string, context: SourceContext) => Promise<SourceResult>;

// Smart first: on equal scores the first ranking decides the order (see fuseRankings).
const SOURCES: Record<SearchSource, SourceRun> = {
  smart: async (query, { base, smartSize, language, signal }) => {
    const smartSearchDto = { ...base, query, language, size: smartSize };
    const { assets } = await searchSmart({ smartSearchDto }, { signal });
    const { items, nextPage } = assets;
    return { ranking: { source: 'smart', groups: items.map(({ id }) => [id]) }, assets: items, nextPage };
  },
  album: async (_query, context) => {
    const groups = rankMatches(await albums.get(), (album) =>
      Math.max(fuzzyScore(context.words, album.albumName), fuzzyScore(context.words, album.description)),
    );
    // inside an album page the base already holds albumIds, and the server wants photos in ALL of them
    return setRanking('album', groups, ({ id }) => ({ albumIds: [...(context.base.albumIds ?? []), id] }), context);
  },
  tag: async (_query, context) => {
    const groups = rankMatches(await tags.get(), (tag) => fuzzyScore(context.words, tag.name));
    return setRanking('tag', groups, ({ id }) => ({ tagIds: [...(context.base.tagIds ?? []), id] }), context);
  },
  place: async (_query, context) => {
    if (context.base.city) {
      return undefined;
    }
    const groups = rankMatches(await loadPhotoPlaces(), (place) => fuzzyScore(context.words, place.name));
    return setRanking('place', groups, ({ name, admin1name }) => ({ city: name, state: admin1name }), context);
  },
  fileName: (_query, context) => wordRanking('fileName', 'originalFileName', context),
  description: (_query, context) => wordRanking('description', 'description', context),
  ocr: async (query, context) => {
    const items = await assetsFor({ ocr: query }, context);
    return { ranking: { source: 'ocr', groups: [items.map(({ id }) => id)] }, assets: items };
  },
};

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

/**
 * Runs every source and returns the fused photos, best first, plus smart search's next page. A failing
 * source (smart search while the ML service is down) only drops out; the search fails only when all fail.
 */
export const searchAll = async (
  query: string,
  {
    base = {},
    size = 250,
    smartSize = size,
    language,
    signal,
  }: { base?: SearchBase; size?: number; smartSize?: number; language?: string; signal?: AbortSignal } = {},
) => {
  const context: SourceContext = { words: searchWords(query), base, size, smartSize, language, signal };
  const results = await Promise.allSettled(Object.values(SOURCES).map((run) => run(query, context)));
  signal?.throwIfAborted();

  const rankings: Ranking[] = [];
  const assets = new Map<string, AssetResponseDto>();
  let nextPage: string | null = null;
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) {
      continue;
    }
    rankings.push(result.value.ranking);
    nextPage ??= result.value.nextPage ?? null;
    for (const asset of result.value.assets) {
      assets.set(asset.id, asset);
    }
  }
  const failure = results.find((result) => result.status === 'rejected');
  if (rankings.length === 0 && failure) {
    throw failure.reason;
  }

  const items = fuseRankings(rankings).flatMap((id) => assets.get(id) ?? []);
  // a date sort from the filter panel beats relevance, as it does for smart search
  if (base.order) {
    const direction = base.order === 'asc' ? 1 : -1;
    items.sort((a, b) => direction * a.localDateTime.localeCompare(b.localDateTime));
  }
  return { items, nextPage };
};

// ---- hooks for Gallery's search surfaces ----

/** Search palette, Photos section. Same scope as Gallery's smart mode there. */
export const searchAllForPalette = async (
  query: string,
  base: SearchBase,
  signal: AbortSignal,
): Promise<ProviderStatus> => {
  try {
    const { items: fused } = await searchAll(query, { base, size: 25, signal });
    const items = fused.slice(0, 5);
    return items.length === 0 ? { status: 'empty' } : { status: 'ok', items, total: items.length };
  } catch (error: unknown) {
    if (isAbort(error)) {
      throw error;
    }
    return { status: 'error', message: error instanceof Error ? error.message : 'unknown error' };
  }
};

/**
 * Drop-in for `searchSmart` on the results page. In "Alles" mode page 1 is the fused list; later pages carry
 * on with smart search alone (the page dedupes what it already shows), so scrolling keeps finding photos.
 */
export const searchSmartOrAll = async (mode: SearchMode, { smartSearchDto }: { smartSearchDto: SmartSearchDto }) => {
  const { query, queryAssetId, language, page = 1, size = 100, ...base } = smartSearchDto;
  if (mode !== SDS_ALL_MODE || !query?.trim() || queryAssetId || page > 1) {
    return searchSmart({ smartSearchDto });
  }
  return { assets: await searchAll(query, { base, smartSize: size, language }) };
};

/** "Alles" becomes the default once per browser, also for users whose last mode was smart. */
export const sdsDefaultSearchMode = () => {
  const key = 'sds.searchMode.alles';
  if (localStorage.getItem(key) === null) {
    localStorage.setItem(key, '1');
    localStorage.setItem('searchQueryType', SDS_ALL_MODE);
  }
};
