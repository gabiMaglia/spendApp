import { createSettingsStore, useSettingsStore } from '../settingsStore';
import { createStorage } from '@/src/utils/createStorage';
import { useAuthStore } from '../authStore';
import type { User } from '@/src/types/models';

const USER_A = { id: 'userA' } as User;
const USER_B = { id: 'userB' } as User;

function setActive(u: User | null) {
  useAuthStore.setState({ currentUser: u });
}

describe('settingsStore (preferencias por cuenta)', () => {
  beforeEach(() => {
    createStorage('settings').clearAll();
    setActive(USER_A);
    useSettingsStore.setState({ notifExpenses: true, notifDeletions: true, notifInvites: true });
  });

  it('los 3 flags arrancan en true', () => {
    const s = useSettingsStore.getState();
    expect(s.notifExpenses).toBe(true);
    expect(s.notifDeletions).toBe(true);
    expect(s.notifInvites).toBe(true);
  });

  it('setNotifExpenses persiste y sobrevive a un store fresco + hydrate (misma cuenta)', () => {
    useSettingsStore.getState().setNotifExpenses(false);
    expect(useSettingsStore.getState().notifExpenses).toBe(false);

    const fresh = createSettingsStore();
    fresh.getState().hydrate();
    expect(fresh.getState().notifExpenses).toBe(false);
  });

  it('los flags persisten independientes entre sí', () => {
    useSettingsStore.getState().setNotifDeletions(false);

    const fresh = createSettingsStore();
    fresh.getState().hydrate();
    expect(fresh.getState().notifDeletions).toBe(false);
    expect(fresh.getState().notifExpenses).toBe(true);
    expect(fresh.getState().notifInvites).toBe(true);
  });

  // El fix de aislamiento por cuenta: lo que configura una cuenta NO lo ve otra.
  it('aísla por cuenta: lo que apaga A no lo ve B, y A lo recupera al volver', () => {
    setActive(USER_A);
    useSettingsStore.getState().setNotifExpenses(false);

    // B entra y hidrata → default true (no ve el de A)
    setActive(USER_B);
    useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().notifExpenses).toBe(true);

    // A vuelve → recupera su false
    setActive(USER_A);
    useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().notifExpenses).toBe(false);
  });

  it('sin usuario activo, hydrate deja los defaults (true) y el setter no persiste', () => {
    setActive(null);
    useSettingsStore.getState().setNotifExpenses(false); // no-op sin cuenta
    useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().notifExpenses).toBe(true);
  });
});
