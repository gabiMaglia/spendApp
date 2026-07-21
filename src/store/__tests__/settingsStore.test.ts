import { createSettingsStore, useSettingsStore } from '../settingsStore';
import { createStorage } from '@/src/utils/createStorage';

describe('settingsStore', () => {
  beforeEach(() => {
    // el mock de MMKV respalda todas las instancias con un mismo Map en memoria
    // que persiste entre tests de este archivo — lo limpiamos y reseteamos el
    // estado en memoria (mismo patrón que themeStore.test.ts).
    createStorage('settings').clearAll();
    useSettingsStore.setState({
      notifExpenses: true,
      notifDeletions: true,
      notifInvites: true,
    });
  });

  it('defaults all 3 flags to true when nothing was persisted yet', () => {
    const state = useSettingsStore.getState();
    expect(state.notifExpenses).toBe(true);
    expect(state.notifDeletions).toBe(true);
    expect(state.notifInvites).toBe(true);
  });

  it('setNotifExpenses updates in-memory state and persists it', () => {
    useSettingsStore.getState().setNotifExpenses(false);
    expect(useSettingsStore.getState().notifExpenses).toBe(false);

    useSettingsStore.getState().setNotifExpenses(true);
    expect(useSettingsStore.getState().notifExpenses).toBe(true);
  });

  it('setNotifDeletions updates in-memory state and persists it', () => {
    useSettingsStore.getState().setNotifDeletions(false);
    expect(useSettingsStore.getState().notifDeletions).toBe(false);
  });

  it('setNotifInvites updates in-memory state and persists it', () => {
    useSettingsStore.getState().setNotifInvites(false);
    expect(useSettingsStore.getState().notifInvites).toBe(false);
  });

  it('flags persist independently of each other', () => {
    useSettingsStore.getState().setNotifExpenses(false);
    expect(useSettingsStore.getState().notifDeletions).toBe(true);
    expect(useSettingsStore.getState().notifInvites).toBe(true);
  });

  // Mismo caso que protegía themeStore (D2): el valor persistido debe leerse
  // SINCRÓNICAMENTE al crear el store, sin depender de un hydrate() posterior,
  // para que no haya flash del valor default en el primer render.
  it('a freshly created store reads persisted flags synchronously, with no hydrate() call', () => {
    createStorage('settings').set('notif_expenses', false);
    createStorage('settings').set('notif_deletions', false);

    const freshStore = createSettingsStore();

    expect(freshStore.getState().notifExpenses).toBe(false);
    expect(freshStore.getState().notifDeletions).toBe(false);
    expect(freshStore.getState().notifInvites).toBe(true);
  });

  it('a freshly created store falls back to true when nothing was persisted', () => {
    const freshStore = createSettingsStore();
    expect(freshStore.getState().notifExpenses).toBe(true);
    expect(freshStore.getState().notifDeletions).toBe(true);
    expect(freshStore.getState().notifInvites).toBe(true);
  });
});
