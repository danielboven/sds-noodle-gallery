# SDS search: the "Alles" mode and its weights

**Keep this file in sync with `SDS_SEARCH_WEIGHTS` and the constants in `web/src/lib/sds/hybrid-search.ts`.** Any change to a weight or constant changes this file in the same commit, with the reason.

## What it does

"Alles" ("Everything" in English) is the default mode of the search palette (Ctrl+K) and of the full results page that Enter or "See all results" opens. Smart search (CLIP) only sees what is in a photo. "Alles" also finds photos by the names people gave things: albums, tags, places and renamed files.

Each source below returns its own ranked list. The lists are merged with **weighted Reciprocal Rank Fusion** (Cormack, Clarke & Büttcher, SIGIR 2009):

```
score(photo) = Σ over sources  weight(source) / (RRF_K + rank in that source)
```

RRF only looks at ranks, so a CLIP distance and a name match never have to be compared on one scale. That is why it needs no tuning: `RRF_K = 60` is the paper's value and the default in Elasticsearch, OpenSearch, Azure AI Search and Chroma.

## Weights

| Source | Weight | How it matches | Why this weight |
|---|---|---|---|
| Album name and description | **3** | fuzzy, in the browser | Albums are named by people (project, customer, address in the description). The strongest signal at SDS. |
| Tag | **2** | fuzzy, in the browser | One shared, curated tag list. |
| Place | **1.5** | fuzzy, in the browser | Place names on the photos, from PDOK. Exact village names. |
| Smart (CLIP) | **1** | vector search on the server | What is visible in the photo. |
| File name | **1** | substring per query word, on the server | About 20% of SDS photos are renamed by hand. Camera names (`IMG_4821`) rarely match a real query, so they add little noise. |
| Photo description | **0.5** | substring per query word, on the server | Rarely filled in. When it is, it is a deliberate hint. |
| OCR | **0.5** | trigram match on the server | On. Finds van lettering and site signs, but is noisy. |

People and spaces are not sources. People is switched off at SDS, and all photos are in the one SDS space.

## Constants

| Constant | Value | Meaning |
|---|---|---|
| `RRF_K` | 60 | RRF smoothing; makes the gap between rank 1 and rank 2 small |
| `MIN_MATCH` | 0.5 | Minimum fuzzy score (0–1) for an album, tag or place name to count |
| `MAX_SETS` | 5 | At most this many matching albums, tags and places are opened, each |
| `MAX_WORDS` | 3 | At most this many query words (3+ letters) are searched in file names and descriptions |
| Sizes | palette 25 per source (shows 5); results page 250 per source, smart 100 | Photos fetched per request |

## How the ranking behaves

- **A matched album, tag or place is one rank.** All its photos share that rank, so photo 400 of an album is not pushed down by the 399 before it. Smart search orders the photos inside it: on equal scores the smart order wins.
- **Fuzzy name matching** (`fuzzyScore`) is trigram similarity, the same idea as Postgres `pg_trgm`, done in the browser on the cached album, tag and place lists. A name scores the better of "how much of the query is in the name" and "how much of the name is in the query". A query word inside a longer word counts fully ("goot" finds "Dakgoot"), but not the other way round ("Dak" does not match "dakkapel"). Matching ignores case and accents and tolerates typos ("bakum" finds Bakkum).
- **Albums include the SDS space's albums.** The list is the user's own and shared albums plus every album of every space the user is a member of (`getSharedSpaceAlbums`), so albums made by someone else in the SDS space are found too. The server checks access per album.
- **File name and description are searched per word.** Photos matching more of the query words rank higher (`IMG_3938` finds `IMG_3938.mov` above other `IMG_` files).
- **One failing source drops out** (for example smart search while the ML service is down). The search only fails when every source fails.
- **Filters still apply.** On the results page every source gets the filter panel's filters. A date sort from the panel overrides relevance.
- **The results page:** page 1 is the fused list. Scrolling on loads further pages of smart search alone, without repeating photos.

## Limits

- The filter panel's suggestions on the results page (cities, cameras, ...) come from smart search, not from the fused list.
- A query costs up to about 15 requests (one per opened album, tag or place, per query word, plus smart and OCR). The palette waits 150 ms after typing, and cancels requests a new keystroke makes obsolete.
- Album, tag and place lists are cached in the browser for 5 minutes, so a new album is found after at most 5 minutes.

## Changing a weight

1. Change `SDS_SEARCH_WEIGHTS` (or a constant) in `web/src/lib/sds/hybrid-search.ts`.
2. Update the table above, with the reason.
3. Run `cd web && pnpm exec vitest --run src/lib/sds`. The tests pin behaviour, not the exact weights.
4. Try 15–20 real SDS queries (project numbers, places, customers, building types) before and after.

## Sources

- Cormack, Clarke & Büttcher, "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods", SIGIR 2009: https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
- Chroma, hybrid search with weighted RRF (`weight / (k + rank)`, k = 60): https://docs.trychroma.com/cloud/search-api/hybrid-search
