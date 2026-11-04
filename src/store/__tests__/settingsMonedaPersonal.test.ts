import { createStorage } from '@/src/utils/createStorage';
import { createSettingsStore } from '../settingsStore';
import { useAuthStore } from '../authStore';
import type { User } from '@/src/types/models';

const user = (id: string) => ({ id, name: id, email: `${id}@t.local`, authProvider: 'google' } as User);

beforeEach(() => {
  createStorage('settings').clearAll();
  useAuthStore.setState({ currentUser: user('u1') });
});

describe('última moneda de un gasto personal (T-255)', () => {
  it('arranca sin valor: nunca se usó', () => {
    const s = createSettingsStore();
    s.getState().hydrate();
    expect(s.getState().lastPersonalCurrency).toBeNull();
  });

  it('sobrevive al reinicio y es por cuenta', () => {
    const s = createSettingsStore();
    s.getState().setLastPersonalCurrency('CLP');

    const s2 = createSettingsStore();
    s2.getState().hydrate();
    expect(s2.getState().lastPersonalCurrency).toBe('CLP');

    useAuthStore.setState({ currentUser: user('u2') });
    s2.getState().hydrate();
    expect(s2.getState().lastPersonalCurrency).toBeNull();
  });
});
