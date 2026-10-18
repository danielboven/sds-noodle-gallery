import type { SharedSpaceMemberResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { SharedSpaceRole } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import MembersPage from './+page.svelte';

// SDS: co-owners on the members page (src/lib/sds/space-roles.ts). Same mocks as space-members-page.spec.ts.
const { mockAuthManager } = vi.hoisted(() => ({ mockAuthManager: { user: { id: 'me', isAdmin: false } } }));
vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: mockAuthManager }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  const { default: MockSelect } = await import('./mock-select.test-wrapper.svelte');
  return { ...original, Select: MockSelect, modalManager: { show: vi.fn(), showDialog: vi.fn() } };
});

const member = (userId: string, role: SharedSpaceRole): SharedSpaceMemberResponseDto =>
  ({ userId, role, name: userId, email: `${userId}@sds.nl`, contributionCount: 0 }) as never;

const renderPage = (members: SharedSpaceMemberResponseDto[]) =>
  render(TestWrapper as Component<{ component: typeof MembersPage; componentProps: object }>, {
    component: MembersPage,
    componentProps: {
      data: {
        space: { id: 's1', name: 'SDS', color: 'primary', createdById: 'creator' } as SharedSpaceResponseDto,
        members,
        linkedAlbums: [],
      },
    },
  });

const rowOf = (name: string) => screen.getByText(name).closest('.border-b') as HTMLElement;

describe('SDS co-owners on the members page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers Owner in the role menu and the menu for co-owners, but not for yourself or the creator', () => {
    renderPage([
      member('creator', SharedSpaceRole.Owner),
      member('me', SharedSpaceRole.Owner),
      member('co-owner', SharedSpaceRole.Owner),
      member('editor', SharedSpaceRole.Editor),
    ]);

    expect(within(rowOf('creator')).getByTestId('role-badge-owner')).toBeInTheDocument();
    expect(within(rowOf('me')).getByTestId('role-badge-owner')).toBeInTheDocument();
    expect(within(rowOf('co-owner')).getByTestId('role-select')).toBeInTheDocument();
    expect(within(rowOf('editor')).getByTestId(`role-option-${SharedSpaceRole.Owner}`)).toHaveTextContent('owner');
  });

  it('promotes an editor to owner and demotes a co-owner to editor', async () => {
    renderPage([member('me', SharedSpaceRole.Owner), member('editor', SharedSpaceRole.Editor)]);
    await fireEvent.click(within(rowOf('editor')).getByTestId(`role-option-${SharedSpaceRole.Owner}`));
    expect(sdkMock.updateMember).toHaveBeenCalledWith({
      id: 's1',
      userId: 'editor',
      sharedSpaceMemberUpdateDto: { role: SharedSpaceRole.Owner },
    });

    renderPage([member('me', SharedSpaceRole.Owner), member('co-owner', SharedSpaceRole.Owner)]);
    await fireEvent.click(within(rowOf('co-owner')).getByTestId(`role-option-${SharedSpaceRole.Editor}`));
    expect(sdkMock.updateMember).toHaveBeenCalledWith({
      id: 's1',
      userId: 'co-owner',
      sharedSpaceMemberUpdateDto: { role: SharedSpaceRole.Editor },
    });
  });

  it('shows no role menu at all to a non-owner', () => {
    mockAuthManager.user = { id: 'editor', isAdmin: false };
    renderPage([member('creator', SharedSpaceRole.Owner), member('editor', SharedSpaceRole.Editor)]);
    expect(screen.queryByTestId('role-select')).not.toBeInTheDocument();
    mockAuthManager.user = { id: 'me', isAdmin: false };
  });
});
