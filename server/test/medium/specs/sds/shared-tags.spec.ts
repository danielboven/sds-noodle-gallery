import { Kysely } from 'kysely';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { DB } from 'src/schema/index.js';
import { sharedTagOwnerId } from 'src/sds/shared-tags.js';
import { TagService } from 'src/services/tag.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = () =>
  newMediumService(TagService, {
    database: defaultDatabase,
    real: [AssetRepository, TagRepository, AccessRepository],
    mock: [EventRepository, JobRepository, LoggingRepository],
  });

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('SDS shared tags', () => {
  it('stores one tag per name for everyone, under the oldest admin', async () => {
    const { sut, ctx } = setup();
    ctx.getMock(JobRepository).queueAll.mockResolvedValue();
    ctx.getMock(EventRepository).emit.mockResolvedValue();
    const { user: admin } = await ctx.newUser({ isAdmin: true });
    const { user: joey } = await ctx.newUser();
    const { user: harro } = await ctx.newUser();
    const joeyAuth = factory.auth({ user: joey });
    const harroAuth = factory.auth({ user: harro });
    const { asset: harroAsset } = await ctx.newAsset({ ownerId: harro.id });

    const [joeyTag] = await sut.upsert(joeyAuth, { tags: ['Soort/Dakkapel'] });
    const [harroTag] = await sut.upsert(harroAuth, { tags: ['Soort/Dakkapel'] });
    expect(harroTag.id).toBe(joeyTag.id);

    const owner = await sharedTagOwnerId(defaultDatabase).executeTakeFirstOrThrow();
    const stored = await defaultDatabase
      .selectFrom('tag')
      .select('userId')
      .where('id', '=', joeyTag.id)
      .executeTakeFirstOrThrow();
    expect(stored.userId).toBe(owner.id);

    // Harro sees and can attach the tag Joey "created"
    expect((await sut.getAll(harroAuth)).map(({ id }) => id)).toContain(joeyTag.id);
    await expect(sut.bulkTagAssets(harroAuth, { tagIds: [joeyTag.id], assetIds: [harroAsset.id] })).resolves.toEqual({
      count: 1,
    });

    // Joey cannot remove it from Harro's photo (he may not edit it), Harro can
    await sut.removeAssets(joeyAuth, joeyTag.id, { ids: [harroAsset.id] });
    expect(await ctx.get(TagRepository).getAssetIds(joeyTag.id, [harroAsset.id])).toEqual(new Set([harroAsset.id]));
    await expect(sut.removeAssets(harroAuth, joeyTag.id, { ids: [harroAsset.id] })).resolves.toEqual([
      { id: harroAsset.id, success: true },
    ]);

    // Only admins rename or delete
    await expect(sut.update(harroAuth, joeyTag.id, { name: 'X' })).rejects.toThrow('no tag.update access');
    await expect(sut.remove(harroAuth, joeyTag.id)).rejects.toThrow('no tag.delete access');
    await expect(
      sut.update(factory.auth({ user: { ...admin, isAdmin: true } }), joeyTag.id, { color: '#e6001c' }),
    ).resolves.toEqual(expect.objectContaining({ id: joeyTag.id }));
  });
});
