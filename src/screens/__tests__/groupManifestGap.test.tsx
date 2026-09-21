import React from 'react';
import { render } from '@testing-library/react-native';
import GroupDetailScreen from '@/app/groups/[id]';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useAuthStore } from '@/src/store/authStore';
import type { Group, User } from '@/src/types/models';

/**
 * Task 7: el aviso de manifiesto incompleto en la pantalla de detalle de
 * grupo (T-085 / plan compactacion-ckey-manifiesto).
 *
 * `useManifestGap` ya tiene su propio test (`src/sync/__tests__/useManifestGap.test.ts`)
 * que cubre la lógica de sondeo contra `manifestHealth`; acá sólo importa el
 * cableado en la pantalla — que el banner aparezca cuando el hook dice que
 * falta algo, y que ceda el paso al banner de `falloDeSync` (`too_large`/
 * `no_key`, T-058) cuando los dos aplican a la vez, porque ése es más
 * accionable y no hay que apilar dos avisos.
 */
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'g1' }),
}));

const mockUseManifestGap = jest.fn((_groupId: string) => false);
jest.mock('@/src/sync/useManifestGap', () => ({
  useManifestGap: (groupId: string) => mockUseManifestGap(groupId),
}));

const mockUseGroupSyncFailure = jest.fn(
  (_groupId: string) => null as null | { reason: 'too_large' | 'no_key' },
);
jest.mock('@/src/sync/useSyncFailure', () => ({
  useGroupSyncFailure: (groupId: string) => mockUseGroupSyncFailure(groupId),
  claveDeFalloDeSync: (reason: string) => `sync.failure_${reason}`,
}));

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Group);

beforeEach(() => {
  mockUseManifestGap.mockReturnValue(false);
  mockUseGroupSyncFailure.mockReturnValue(null);
  useAuthStore.setState({ currentUser: { id: 'ana', name: 'Ana' } as User });
  useGroupStore.setState({ groups: [grupo()] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useUserStore.setState({ users: [] });
});

describe('aviso de manifiesto incompleto en el detalle de grupo', () => {
  it('sin gap no se muestra ningún aviso', () => {
    const { queryByText } = render(<GroupDetailScreen />);
    expect(queryByText('sync.manifest_gap_title')).toBeNull();
  });

  it('con gap se muestra el aviso', () => {
    mockUseManifestGap.mockReturnValue(true);
    const { getByText } = render(<GroupDetailScreen />);
    expect(getByText('sync.manifest_gap_title')).toBeTruthy();
    expect(getByText('sync.manifest_gap_body')).toBeTruthy();
  });

  /**
   * El banner de `too_large`/`no_key` es más accionable —le dice al usuario
   * qué hacer— y el de manifiesto incompleto no aporta nada nuevo en ese caso:
   * apilar los dos sólo entrenaría a ignorarlos.
   */
  it('con los dos avisos aplicables, sólo se muestra el de falloDeSync', () => {
    mockUseManifestGap.mockReturnValue(true);
    mockUseGroupSyncFailure.mockReturnValue({ reason: 'too_large' });
    const { getByText, queryByText } = render(<GroupDetailScreen />);
    expect(getByText('sync.failure_title')).toBeTruthy();
    expect(queryByText('sync.manifest_gap_title')).toBeNull();
  });
});
