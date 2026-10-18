import { Kysely } from 'kysely';
import { Stats } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MetadataRepository } from 'src/repositories/metadata.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { DB } from 'src/schema/index.js';
import { MetadataService } from 'src/services/metadata.service.js';
import { updateLockedColumns } from 'src/utils/database.js';
import { upsertTags } from 'src/utils/tag.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB, newRandomImage } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { sut, ctx } = newMediumService(MetadataService, {
    database: defaultDatabase,
    real: [
      AssetRepository,
      AssetJobRepository,
      ConfigRepository,
      MetadataRepository,
      SystemMetadataRepository,
      TagRepository,
    ],
    mock: [EventRepository, StorageRepository, LoggingRepository],
  });
  ctx.getMock(EventRepository).emit.mockResolvedValue();
  ctx.getMock(StorageRepository).stat.mockResolvedValue({
    size: 123_456,
    mtime: new Date(654_321),
    mtimeMs: 654_321,
    birthtimeMs: 654_322,
  } as Stats);
  return { sut, ctx };
};

const assetTags = (assetId: string) =>
  defaultDatabase
    .selectFrom('tag_asset')
    .innerJoin('tag', 'tag.id', 'tag_asset.tagId')
    .select('tag.value')
    .where('tag_asset.assetId', '=', assetId)
    .orderBy('tag.value')
    .execute()
    .then((rows) => rows.map(({ value }) => value));

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('SDS tags from files', () => {
  it('ignores embedded keywords but keeps tags set in Gallery through the sidecar round trip', async () => {
    const { sut, ctx } = setup();
    const filePath = join(tmpdir(), 'sds-file-tags.png');
    await rm(`${filePath}.xmp`, { force: true });
    await writeFile(filePath, newRandomImage());
    await ctx.get(MetadataRepository).writeTags(filePath, { Keywords: ['Embedded'], TagsList: ['Embedded/List'] });

    await ctx.newUser({ isAdmin: true });
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ originalPath: filePath, ownerId: user.id });

    // upload: the embedded keywords never become tags
    await sut.handleMetadataExtraction({ id: asset.id });
    await expect(assetTags(asset.id)).resolves.toEqual([]);

    // tag through the API, the way TagService does it (tag_asset + locked exif tags)
    const tagRepository = ctx.get(TagRepository);
    const [tag] = await upsertTags(tagRepository, { userId: user.id, tags: ['Soort/Dakkapel'] });
    await tagRepository.upsertAssetIds([{ tagId: tag.id, assetId: asset.id }]);
    await ctx.get(AssetRepository).upsertExif({
      exif: updateLockedColumns({ assetId: asset.id, tags: ['Soort/Dakkapel'] }),
      lockedPropertiesBehavior: 'append',
    });

    // Gallery then writes the sidecar, unlocks the tags and re-reads the metadata
    await sut.handleSidecarWrite({ id: asset.id });
    await sut.handleMetadataExtraction({ id: asset.id });
    await expect(assetTags(asset.id)).resolves.toEqual(['Soort/Dakkapel']);

    await rm(`${filePath}.xmp`, { force: true });
  });
});
