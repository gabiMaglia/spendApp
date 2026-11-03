import {
  respaldoDeInvitadoAdoptable, adoptarRespaldoDeInvitado,
} from '../adoptarRespaldoDeInvitado';
import { buildBackup, type BackupFile } from '../backup';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useAuthStore, pendingGuestAccountId, clearGuestAccount } from '@/src/store/authStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import { useEntryGateStore, __resetEntryGate } from '@/src/store/entryGateStore';
import { writeScoped } from '@/src/store/userScope';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { barrerScope } from '@/src/store/accountLink';
import { recargarAlias } from '@/src/store/identityAlias';
import { useRecurringStore } from '@/src/store/recurringStore';
import { savePeer } from '@/src/sync/contactos/contactPeers';
import type { Group, User } from '@/src/types/models';

jest.mock('@/src/sync/motor/relayEngine', () => ({
  schedulePublish: jest.fn(),
  anunciarMiTarjeta: jest.fn(),
}));

function user(id: string, over: Partial<User> = {}): User {
  return {
    id, updatedAt: 1, isDeleted: false, name: `U-${id}`, email: '',
    authProvider: 'guest', createdAt: 0, ...over,
  };
}
function group(id: string): Group {
  return {
    id, updatedAt: 1, isDeleted: false, name: id, memberIds: ['viejo'], miembros: {},
    currency: 'ARS', createdAt: 0, createdById: 'viejo',
  };
}

const DUENO = user('invitado-viejo', { name: 'Gabi' });
const SESION_NUEVA = user('invitado-nuevo', { name: 'Invitado' });

/** Respaldo propio de un invitado, con una preferencia que sólo viaja si el respaldo se trata como PROPIO. */
function respaldoDeInvitado(over: Partial<BackupFile> = {}): BackupFile {
  return {
    format: 'splitp2p-backup', version: 3, exportedAt: 1,
    groups: [group('g1')], expenses: [], payments: [], users: [DUENO],
    personalEntries: [], personalBudget: { currency: 'ARS', monthlyAmount: 0, includeOwedToMe: false },
    ownerId: DUENO.id,
    settings: {
      displayCurrency: 'USD', language: 'auto', skin: 'aero' as never,
      notifExpenses: true, notifDeletions: true, notifInvites: true, notifSettlements: true,
    },
    ...over,
  };
}

beforeEach(() => {
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useUserStore.setState({ users: [] });
  usePersonalStore.setState({ entries: [], budget: { currency: 'ARS', monthlyAmount: 0, includeOwedToMe: false } });
  useRecurringStore.setState({ recurring: [] });
  useAuthStore.setState({ currentUser: SESION_NUEVA });
  clearGuestAccount();
  __resetEntryGate();
  barrerScope(SESION_NUEVA.id); // los contactos persisten entre tests
  recargarAlias();
});

describe('respaldoDeInvitadoAdoptable (T-249)', () => {
  it('invitado sin datos + respaldo cuyo dueño era invitado → devuelve el registro del dueño', () => {
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())?.name).toBe('Gabi');
  });

  it('sesión de Google/Apple → null (comportamiento actual)', () => {
    useAuthStore.setState({ currentUser: user('g:1', { authProvider: 'google' }) });
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())).toBeNull();
  });

  it('el invitado ya tiene grupos, gastos o pagos → null', () => {
    useGroupStore.setState({ groups: [group('mio')] });
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())).toBeNull();
    useGroupStore.setState({ groups: [] });
    useExpenseStore.setState({ expenses: [{ id: 'e', isDeleted: false } as never] });
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())).toBeNull();
    useExpenseStore.setState({ expenses: [] });
    usePaymentStore.setState({ payments: [{ id: 'p', isDeleted: false } as never] });
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())).toBeNull();
  });

  it('M3: movimientos personales, presupuesto, recurrentes o contactos cuentan como datos propios', () => {
    usePersonalStore.setState({ entries: [{ id: 'p1', isDeleted: false } as never] });
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())).toBeNull();
    usePersonalStore.setState({ entries: [{ id: 'p1', isDeleted: true } as never] });
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())).not.toBeNull();

    usePersonalStore.setState({ budget: { currency: 'ARS', monthlyAmount: 5000, includeOwedToMe: false } });
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())).toBeNull();
    usePersonalStore.setState({ budget: { currency: 'ARS', monthlyAmount: 0, includeOwedToMe: true } });
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())).toBeNull();
    usePersonalStore.setState({ budget: { currency: 'ARS', monthlyAmount: 0, includeOwedToMe: false } });

    useRecurringStore.setState({ recurring: [{ id: 'r1', isDeleted: false } as never] });
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())).toBeNull();
    useRecurringStore.setState({ recurring: [] });

    savePeer('amigo', { secret: 's'.repeat(8) });
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())).toBeNull();
  });

  it('un grupo borrado (tombstone) no cuenta como dato propio', () => {
    useGroupStore.setState({ groups: [{ ...group('x'), isDeleted: true }] });
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())).not.toBeNull();
  });

  it('respaldo sin ownerId (v1) → null', () => {
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado({ ownerId: undefined }))).toBeNull();
  });

  it('el dueño no figura en users, o no era invitado → null', () => {
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado({ users: [] }))).toBeNull();
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado({
      users: [{ ...DUENO, authProvider: 'google' }],
    }))).toBeNull();
  });

  it('el respaldo ya es mío (mismo id) → null: no hay nada que adoptar', () => {
    useAuthStore.setState({ currentUser: DUENO });
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())).toBeNull();
  });

  it('sin sesión → null', () => {
    useAuthStore.setState({ currentUser: null });
    expect(respaldoDeInvitadoAdoptable(respaldoDeInvitado())).toBeNull();
  });
});

describe('adoptarRespaldoDeInvitado (T-249)', () => {
  it('la sesión pasa a ser la identidad del respaldo (mismo id y registro)', () => {
    adoptarRespaldoDeInvitado(respaldoDeInvitado(), DUENO);
    expect(useAuthStore.getState().currentUser).toMatchObject({ id: DUENO.id, name: 'Gabi', authProvider: 'guest' });
  });

  it('el import se aplica como PROPIO: las preferencias del dueño sí se restauran', () => {
    adoptarRespaldoDeInvitado(respaldoDeInvitado(), DUENO);
    expect(useSettingsStore.getState().displayCurrency).toBe('USD');
    expect(useGroupStore.getState().groups.map(g => g.id)).toEqual(['g1']);
  });

  it('la fusión pendiente de invitado apunta al id adoptado, no al descartado', () => {
    adoptarRespaldoDeInvitado(respaldoDeInvitado(), DUENO);
    expect(pendingGuestAccountId()).toBe(DUENO.id);
  });

  it('pide la verificación del buzón, como cualquier cambio de cuenta', () => {
    adoptarRespaldoDeInvitado(respaldoDeInvitado(), DUENO);
    expect(useEntryGateStore.getState().estado).toBe('pendiente');
  });

  it('no deja datos huérfanos en el scope del id descartado', () => {
    const storage = createSecureStorage('auth');
    writeScoped(storage, 'huerfano_v1', 'x'); // escrito bajo SESION_NUEVA
    expect(storage.getString(`huerfano_v1::u:${SESION_NUEVA.id}`)).toBe('x');
    adoptarRespaldoDeInvitado(respaldoDeInvitado(), DUENO);
    expect(storage.getString(`huerfano_v1::u:${SESION_NUEVA.id}`)).toBeUndefined();
  });

  it('buildBackup tras adoptar firma con el id adoptado', () => {
    adoptarRespaldoDeInvitado(respaldoDeInvitado(), DUENO);
    expect(buildBackup().ownerId).toBe(DUENO.id);
  });
});
