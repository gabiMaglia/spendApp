import { wipeAllAccounts } from '../wipeDevice';
import { useAuthStore } from '../authStore';
import { createSecureStorage, SECURE_IDS } from '@/src/utils/secureStorage';
import { createStorage } from '@/src/utils/createStorage';
import type { User } from '@/src/types/models';

describe('wipeAllAccounts', () => {
  beforeEach(() => {
    SECURE_IDS.forEach(id => createSecureStorage(id).clearAll());
    ['settings', 'tier', 'theme', 'lang'].forEach(id => createStorage(id).clearAll());
  });

  it('borra los datos de TODOS los buckets seguros, no sólo algunos', () => {
    SECURE_IDS.forEach(id => createSecureStorage(id).set('data_v1::u:ua', '[{"id":"x"}]'));

    wipeAllAccounts();

    const sobrevivientes = SECURE_IDS.filter(
      id => createSecureStorage(id).getString('data_v1::u:ua') !== undefined,
    );
    expect(sobrevivientes).toEqual([]);
  });

  it('borra el índice de identidad, que es el punto de "empezar de cero"', () => {
    const auth = createSecureStorage('auth');
    auth.set('acct::known', '[{"accountId":"ua"}]');
    auth.set('acct::p:google:1', 'ua');

    wipeAllAccounts();

    expect(auth.getString('acct::known')).toBeUndefined();
    expect(auth.getString('acct::p:google:1')).toBeUndefined();
  });

  it('cierra la sesión en memoria, no sólo en disco', () => {
    useAuthStore.setState({ currentUser: { id: 'ua' } as User, isPro: true, isLoading: false });

    wipeAllAccounts();

    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(useAuthStore.getState().isPro).toBe(false);
  });

  it('borra preferencias POR CUENTA (settings, tier)', () => {
    createStorage('settings').set('notif_expenses::u:ua', false);
    createStorage('tier').set('is_pro::u:ua', true);

    wipeAllAccounts();

    expect(createStorage('settings').getBoolean('notif_expenses::u:ua')).toBeUndefined();
    expect(createStorage('tier').getBoolean('is_pro::u:ua')).toBeUndefined();
  });

  it('NO borra las preferencias del dispositivo (tema e idioma)', () => {
    createStorage('theme').set('choice', 'dark');
    createStorage('lang').set('lang', 'en');

    wipeAllAccounts();

    expect(createStorage('theme').getString('choice')).toBe('dark');
    expect(createStorage('lang').getString('lang')).toBe('en');
  });

  it('sobre un dispositivo ya vacío no rompe nada', () => {
    expect(() => wipeAllAccounts()).not.toThrow();
  });
});
