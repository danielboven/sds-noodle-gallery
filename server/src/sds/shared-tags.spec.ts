import { Permission } from 'src/enum.js';
import { canChangeSharedTags, ignoreFileTags } from 'src/sds/shared-tags.js';
import { authStub } from 'test/fixtures/auth.stub.js';

describe('SDS shared tags', () => {
  it('lets everyone read and attach tags', () => {
    expect(canChangeSharedTags(authStub.user1, Permission.TagRead)).toBe(true);
    expect(canChangeSharedTags(authStub.user1, Permission.TagAsset)).toBe(true);
  });

  it('keeps renaming and deleting tags with admins', () => {
    expect(canChangeSharedTags(authStub.user1, Permission.TagUpdate)).toBe(false);
    expect(canChangeSharedTags(authStub.user1, Permission.TagDelete)).toBe(false);
    expect(canChangeSharedTags(authStub.admin, Permission.TagUpdate)).toBe(true);
    expect(canChangeSharedTags(authStub.admin, Permission.TagDelete)).toBe(true);
  });

  it('never takes tags from files', () => {
    expect(ignoreFileTags(['Soort/Dakkapel', 'Keyword'])).toEqual([]);
  });
});
