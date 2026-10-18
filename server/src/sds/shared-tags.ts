import { Kysely } from 'kysely';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { Permission } from 'src/enum.js';
import { DB } from 'src/schema/index.js';

// SDS: tags are shared by everyone. Every tag is stored under one fixed account, the oldest admin
// (the account created at install), instead of under the user who typed it, so each tag exists once
// and everybody can pick and attach it. Never delete or demote that account: its tags go with it.
export const sharedTagOwnerId = (db: Kysely<DB>) =>
  db
    .selectFrom('user')
    .select('user.id')
    .where('user.isAdmin', '=', true)
    .where('user.deletedAt', 'is', null)
    .orderBy('user.createdAt')
    .limit(1);

// SDS: everyone may read and attach shared tags; renaming or deleting one changes it for everybody,
// so that stays with admins.
export const canChangeSharedTags = (auth: AuthDto, permission: Permission) =>
  auth.user.isAdmin || (permission !== Permission.TagUpdate && permission !== Permission.TagDelete);
