import type { SharedSpaceMemberResponseDto } from '@immich/sdk';
import { authManager } from '$lib/managers/auth-manager.svelte';

// SDS: Gallery's server lets a space Owner make other members Owner and demote them again, but its member
// lists only offered Editor and Viewer, and showed every Owner as a fixed badge. The role menu (with Owner
// added) is now shown for every member except yourself and the space's creator: the server refuses
// changing your own role and demoting the creator, so those two keep the badge.
export const canChangeSpaceRole = (
  member: Pick<SharedSpaceMemberResponseDto, 'userId'>,
  currentUserId: string | undefined,
  createdById: string | undefined,
) => member.userId !== currentUserId && member.userId !== createdById;

export const currentUserId = () => (authManager.authenticated ? authManager.user.id : undefined);
