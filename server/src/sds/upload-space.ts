import { ForbiddenException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { SharedSpaceRole } from 'src/gallery/enum.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';

// SDS: every upload lands in the SDS space. SDS_UPLOAD_SPACE_ID (in .env) names that space. Only its
// Owners and Editors may upload, and each upload is added to the space straight away, so nothing ends
// up in someone's personal library only. Without the variable Gallery behaves as normal.
const uploadSpaceId = () => process.env.SDS_UPLOAD_SPACE_ID || undefined;

export const requireUploadSpaceEditor = async (repository: SharedSpaceRepository, auth: AuthDto) => {
  const spaceId = uploadSpaceId();
  if (!spaceId) {
    return;
  }

  const member = await repository.getMember(spaceId, auth.user.id);
  if (member?.role !== SharedSpaceRole.Owner && member?.role !== SharedSpaceRole.Editor) {
    throw new ForbiddenException('Uploading requires the Owner or Editor role in the SDS space');
  }
};

export const addToUploadSpace = async (repository: SharedSpaceRepository, auth: AuthDto, assetId: string) => {
  const spaceId = uploadSpaceId();
  if (!spaceId) {
    return;
  }

  await repository.addAssets([{ spaceId, assetId, addedById: auth.user.id }]);
};
