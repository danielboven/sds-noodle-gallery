import { SharedSpaceRole } from 'src/gallery/enum.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { addToUploadSpace, requireUploadSpaceEditor } from 'src/sds/upload-space.js';
import { authStub } from 'test/fixtures/auth.stub.js';

const spaceId = 'sds-space';

const repositoryWith = (role?: SharedSpaceRole) => {
  const repository = {
    getMember: vi.fn().mockResolvedValue(role ? { role } : undefined),
    addAssets: vi.fn().mockResolvedValue([]),
  };
  return repository as typeof repository & SharedSpaceRepository;
};

describe('SDS upload space', () => {
  afterEach(() => {
    delete process.env.SDS_UPLOAD_SPACE_ID;
  });

  it('does nothing without SDS_UPLOAD_SPACE_ID', async () => {
    const repository = repositoryWith();
    await expect(requireUploadSpaceEditor(repository, authStub.user1)).resolves.toBeUndefined();
    await addToUploadSpace(repository, authStub.user1, 'asset-1');
    expect(repository.getMember).not.toHaveBeenCalled();
    expect(repository.addAssets).not.toHaveBeenCalled();
  });

  it.each([SharedSpaceRole.Owner, SharedSpaceRole.Editor])('lets a space %s upload', async (role) => {
    process.env.SDS_UPLOAD_SPACE_ID = spaceId;
    const repository = repositoryWith(role);
    await expect(requireUploadSpaceEditor(repository, authStub.user1)).resolves.toBeUndefined();
    expect(repository.getMember).toHaveBeenCalledWith(spaceId, authStub.user1.user.id);
  });

  it.each([SharedSpaceRole.Viewer, undefined])('refuses an upload from role %s', async (role) => {
    process.env.SDS_UPLOAD_SPACE_ID = spaceId;
    await expect(requireUploadSpaceEditor(repositoryWith(role), authStub.user1)).rejects.toThrow(
      'Uploading requires the Owner or Editor role in the SDS space',
    );
  });

  it('adds the upload to the space on behalf of the uploader', async () => {
    process.env.SDS_UPLOAD_SPACE_ID = spaceId;
    const repository = repositoryWith(SharedSpaceRole.Editor);
    await addToUploadSpace(repository, authStub.user1, 'asset-1');
    expect(repository.addAssets).toHaveBeenCalledWith([
      { spaceId, assetId: 'asset-1', addedById: authStub.user1.user.id },
    ]);
  });
});
