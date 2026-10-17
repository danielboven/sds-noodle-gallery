# SDS fork of Noodle Gallery

This repository (`danielboven/sds-noodle-gallery`) is a fork of [open-noodle/gallery](https://github.com/open-noodle/gallery) with a few small SDS changes on top. Everything SDS lives on the **`sds` branch** as a handful of commits on top of a Gallery release tag. `main` stays a plain copy of upstream; never commit to it.

**Current base:** `v5.9.0`. Update this line after every rebase.

## What the SDS commits change

The rule: SDS code goes in **new files**, and Gallery files only get **single-line** edits, so rebases stay conflict-free.

| Commit | Files | What |
|---|---|---|
| `feat(sds): default user preferences for SDS` | `server/src/utils/preferences.ts` (4 values) + the specs that pin the defaults (`server/src/utils/preferences.spec.ts`, `server/src/services/user-admin.service.spec.ts`, `server/test/medium/specs/services/user.service.spec.ts`, `e2e/src/specs/server/api/user-admin.e2e-spec.ts`) | New users get Tags on (with sidebar link), and People and Memories off |
| `feat(sds): SDS theme colours and fonts` | **new** `web/src/styles/sds-theme.css`; **new** `web/src/lib/assets/fonts/{Montserrat,Genos}/` (variable TTF + OFL); `web/src/app.css` (+1 import line); `web/src/lib/components/album-page/AlbumTitle.svelte` (+`font-display font-medium` class) | Colours, fonts, metal dark mode |
| `feat(sds): SDS logo, favicons and app icons` | `web/static/gallery-logo-*.svg`, `web/static/gallery-loader*.svg`, `web/static/favicon*`, `web/static/apple-icon-180.png`, `web/static/manifest-icon-*.png`, `branding/assets/{favicon.png,favicon.ico,app-icon.png}`; **new** `web/src/lib/sds/sds-logos.ts`; `web/src/hooks.client.ts` (+1 import line) | SDS logo everywhere, including the @immich/ui built-in logos via `logoManager.setLogo` |
| `ci(sds): build the SDS server image for linux/amd64` | **new** `.github/workflows/sds-build-server.yml` | Builds `ghcr.io/danielboven/sds-noodle-gallery-server` when an `sds-v*` tag is pushed |
| `docs(sds): …` | **new** `SDS.md`; `AGENTS.md` (pointer section at the end; `CLAUDE.md` is a symlink to it) | This guide |
| `feat(sds): shared tags for all users` | **new** `server/src/sds/shared-tags.ts` (+ spec, + `server/test/medium/specs/sds/shared-tags.spec.ts`); one-line hooks in `server/src/repositories/tag.repository.ts` (4×), `server/src/repositories/access.repository.ts` (`TagAccess`), `server/src/utils/access.ts` (`Tag*` case), `server/src/services/tag.service.ts` (`removeAssets`), `web/src/lib/components/asset-viewer/DetailPanelTags.svelte` (`onClose`); specs `server/src/services/tag.service.spec.ts`, `web/src/lib/components/asset-viewer/DetailPanelTags.spec.ts` | One tag list for everyone (see "SDS behaviour" below) |
| `feat(sds): never read tags from files` | `server/src/sds/shared-tags.ts` (`ignoreFileTags`); `server/src/services/metadata.service.ts` (1 line); `server/src/services/metadata.service.spec.ts` (`vi.mock` block at the top) | Keywords in files and XMP sidecars never become tags |
| `feat(sds): every upload goes into the SDS space` | **new** `server/src/sds/upload-space.ts` (+ spec); `server/src/services/asset-media.service.ts` (2 lines in `uploadAsset`) | Uploads only for space Owners/Editors, and each upload joins the space |

List them at any time with `git log --oneline <base-tag>..sds`, and see the full diff with `git diff --stat <base-tag>..sds`.

All SDS hooks in Gallery files carry an `// SDS` comment, so `git grep -n "SDS" -- server/src web/src` lists them.

### SDS behaviour

- **Shared tags.** Every tag is stored under one account, the **oldest admin** (the account created at install), instead of under the user who typed it. Everybody sees and attaches the same tags; renaming and deleting a tag is for admins only; anyone who may edit a photo may remove a tag from it. **Never delete that account or take away its admin rights**: the tags belong to it (the database deletes them with the user).
- **No tags from files.** Keywords inside a photo or its XMP sidecar are ignored. Tags come only from Gallery or the API (the import scripts use `PUT /tags` + `PUT /tags/assets`).
- **Uploads go into the space.** With `SDS_UPLOAD_SPACE_ID=<space id>` in the server's `.env`, only Owners and Editors of that space may upload, and every upload is added to it at once. Without the variable Gallery behaves as normal. The space id is the last part of the space's URL (`/spaces/<id>`).
- Upstream tests that pin per-user tags fail on purpose (for example "should not return a tag of another user" in `server/test/medium/specs/services/tag.service.spec.ts` and `test/medium/specs/repositories/tag.repository.spec.ts`, which also create no admin). The SDS behaviour is covered by `server/src/sds/*.spec.ts` and `server/test/medium/specs/sds/`.

### SDS house style (reference)

| Token | Light | Dark |
|---|---|---|
| Primary (`--immich-ui-primary-500`) | `#e6001c` (SDS red) | `#ff545c` (lighter red, hue 357°, 4.0:1 on metal) |
| Chrome (navbar, sidebar, page) | Gallery default `#e9edf3` | `#323240` (SDS metal) |
| Content panel | white | `#1c1c25` |
| Neutral and gray ramps | Gallery default | re-tinted to the metal hue at the same lightness |
| Text font (`--font-sans`) | Montserrat | Montserrat |
| Title font (`--font-display`, `h1` + album title) | Genos 500 | Genos 500 |

`h2`–`h4` (settings panels, modals) deliberately use Montserrat. SDS air `#B9D3E0` and signal `#F3811B` are not used. Source files: `../sds-logo.svg` and `../fonts/ofl/` in the parent `sds-fotobeheer` folder.

## Updating to a new Gallery version

Use the variables below and replace the versions. Prefer **stable** releases (`vX.Y.Z`) over release candidates for production.

```bash
OLD=v5.9.0           # current base (see "Current base" above)
NEW=v5.10.0          # Gallery release to move to
```

### 1. Fetch and review what changed upstream

```bash
git remote add upstream https://github.com/open-noodle/gallery.git   # once
git fetch upstream --tags

# Build pipeline: our workflow copies Gallery's server build job. If any of these changed, review and port it.
git diff $OLD $NEW -- .github/workflows/gallery-prerelease-server.yml .github/actions/apply-branding server/Dockerfile

# Files the SDS commits touch: these are the ones that can conflict.
git diff --stat $OLD $NEW -- $(git diff --name-only $OLD..sds)
```

Also look at the release notes on https://github.com/open-noodle/gallery/releases for theme, logo or preference changes.

### 2. Rebase the SDS commits onto the new tag

```bash
git switch sds
git branch sds-backup-$OLD          # safety net
git rebase --onto $NEW $OLD sds
```

During a rebase, `--ours` is the new Gallery version and `--theirs` is the SDS commit being replayed. How to resolve conflicts:

| File | Resolution |
|---|---|
| `web/static/*.svg`, `*.png`, `*.ico`, `branding/assets/*` (logos, icons) | Keep SDS: `git checkout --theirs <file>` |
| `server/src/utils/preferences.ts` | Take Gallery's new version, then set again: `tags.enabled/sidebarWeb: true`, `people.enabled: false`, `memories.enabled: false` |
| Spec files from commit 1 | Take Gallery's version, then re-apply only the SDS default values; run the tests to find what still needs flipping |
| `web/src/app.css` | Take Gallery's version and re-add `@import './styles/sds-theme.css';` directly after the `gallery-theme.css` import |
| `AlbumTitle.svelte` | Take Gallery's version and add `font-display font-medium` to the title classes again |
| `web/src/hooks.client.ts` | Take Gallery's version and re-add `import '$lib/sds/sds-logos';` |
| `AGENTS.md` (= `CLAUDE.md`) | Take Gallery's version and re-append the "SDS fork" section at the end |
| `tag.repository.ts`, `access.repository.ts` (`TagAccess`), `utils/access.ts`, `tag.service.ts`, `metadata.service.ts`, `asset-media.service.ts`, `DetailPanelTags.svelte` | Take Gallery's version and re-apply the `// SDS` lines; `git show sds-backup-$OLD:<file> \| grep -n SDS` shows them |
| `tag.service.spec.ts`, `metadata.service.spec.ts`, `DetailPanelTags.spec.ts` | Take Gallery's version and re-apply the `// SDS` lines (mock lines, the `vi.mock` block, test W-tags-1) |

Then `git add <file>` and `git rebase --continue`. If it goes wrong: `git rebase --abort` (or `git reset --hard sds-backup-$OLD`).

### 3. Check that nothing new slipped past the SDS styling

```bash
# New hard-coded Gallery logo files or references?
ls web/static | grep -i 'gallery-\|logo\|loader'
grep -rn "gallery-logo\|gallery-loader\|immich-logo" web/src --include='*.svelte' --include='*.ts' --include='*.html' | grep -v spec

# Did Gallery rename or add theme tokens that sds-theme.css overrides?
grep -n "\-\-immich-ui-primary-\|--gallery-chrome\|--font-sans\|--font-display\|--color-gray-" web/src/styles/gallery-theme.css web/src/app.css

# Did the @immich/ui logo API change? (LogoSet shape used by web/src/lib/sds/sds-logos.ts)
grep -n "LogoSet" -A14 web/node_modules/@immich/ui/dist/types.d.ts   # after pnpm install
```

Any new `gallery-*.svg` needs an SDS version. A renamed token needs the same rename in `sds-theme.css`.

```bash
# All SDS hooks still in place? Compare the count with the old branch.
git grep -n "SDS" -- server/src web/src | wc -l
git grep -n "SDS" sds-backup-$OLD -- server/src web/src | wc -l

# New ways to create or attach tags, or to upload, that bypass the hooks?
git diff $OLD $NEW --stat -- server/src/repositories/tag.repository.ts server/src/services/tag.service.ts server/src/utils/tag.ts server/src/services/asset-media.service.ts
git diff $OLD $NEW -- server/src | grep -n "insertInto('tag')\|upsertTags(\|getTagList("
```

Tags must only be written through `TagRepository` (`upsertValue`, `create`); a new `insertInto('tag')` elsewhere needs the shared owner too.

### 4. Test

Node and pnpm versions come from `.nvmrc` and `package.json` (`packageManager`). Without a global pnpm, use `npx -y pnpm@<version>`.

```bash
pnpm install --frozen-lockfile --filter "immich..." --filter "immich-web..."
pnpm --filter @immich/plugin-sdk --filter @immich/sdk build

cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/utils/preferences.spec.ts src/services/user-admin.service.spec.ts src/sds src/services/tag.service.spec.ts src/services/metadata.service.spec.ts src/services/asset-media.service.spec.ts && cd ..
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/sds && cd ..   # needs Docker
cd web && pnpm exec vitest --run src/lib/styles src/lib/components/album-page src/lib/components/asset-viewer/DetailPanelTags.spec.ts && pnpm run build && cd ..
```

### 5. Look at it locally (optional, about 5 minutes)

The test setup in `../local-test/` (outside this repo) runs Gallery's official backend in Docker and this branch's frontend with hot reload:

```bash
# in ../local-test/docker-compose.yml set the image tag to $NEW, then:
docker compose -f ../local-test/docker-compose.yml up -d
cd web && IMMICH_SERVER_URL=http://127.0.0.1:2283/ pnpm exec vite dev --host 127.0.0.1 --port 3001
# open http://127.0.0.1:3001 (check light + dark mode, login, settings, an album, a shared link)
```

Server-side changes (the default preferences) only show in the real SDS image, not in this setup.

### 6. Publish and build

```bash
git push --force-with-lease origin sds
git tag sds-$NEW && git push origin sds-$NEW      # e.g. sds-v5.10.0; a rebuild of the same base: sds-v5.10.0_2
```

The tag starts **SDS Build Server** in GitHub Actions. It produces `ghcr.io/danielboven/sds-noodle-gallery-server:$NEW` (the image tag is the git tag without `sds-`). The machine-learning image is not rebuilt; use `ghcr.io/open-noodle/gallery-ml:$NEW`.

Finally, update **"Current base"** at the top of this file and commit it with `git commit --fixup` onto the `docs(sds)` commit, then autosquash.

### 7. Deploy on the server

```bash
# take a database backup first
docker exec immich_postgres pg_dump -U postgres -d immich > gallery-before-$NEW.sql
```

In the server's `.env`, set **both** to the same Gallery version:

```bash
SDS_VERSION=$NEW       # ghcr.io/danielboven/sds-noodle-gallery-server
IMMICH_VERSION=$NEW    # ghcr.io/open-noodle/gallery-ml
```

Keep `SDS_UPLOAD_SPACE_ID` set to the SDS space's id.

Then `docker compose pull && docker compose up -d` and watch `docker compose logs -f immich-server`.

To roll back, set the previous versions back and restore the `pg_dump` if the new version already ran database migrations. For leaving Gallery entirely, see `docs/docs/guides/switch-back-to-immich.md`.
