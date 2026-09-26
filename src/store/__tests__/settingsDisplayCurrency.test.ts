import { createStorage } from '@/src/utils/createStorage';
import { createSettingsStore } from '../settingsStore';
import { useAuthStore } from '../authStore';
import type { User } from '@/src/types/models';

const user = (id: string): User => ({
  id, name: id, email: `${id}@t.local`, authProvider: 'google',
} as User);

// T-173: `createStorage('settings')` es un singleton de módulo (registrado en
// `BUCKETS`, ver `createStorage.ts`) que sobrevive entre tests del mismo
// archivo. Sin vaciarlo acá, lo que un test escribe para 'u1' (p. ej. "la
// eleccion sobrevive al reinicio") quedaba en disco para el siguiente test —
// invisible en el orden de declaración porque "arranca en ARS" corre primero,
// pero `--randomize` lo expone: si corre después, hereda el BRL ajeno.
beforeEach(() => {
  createStorage('settings').clearAll();
  useAuthStore.setState({ currentUser: user('u1') });
});

describe('moneda maestra de visualizacion', () => {
  it('arranca en ARS si el usuario nunca eligio', () => {
    const s = createSettingsStore();
    s.getState().hydrate();
    expect(s.getState().displayCurrency).toBe('ARS');
  });

  it('la eleccion sobrevive al reinicio de la app', () => {
    const s1 = createSettingsStore();
    s1.getState().setDisplayCurrency('BRL');
    expect(s1.getState().displayCurrency).toBe('BRL');

    // store nuevo = app reabierta
    const s2 = createSettingsStore();
    s2.getState().hydrate();
    expect(s2.getState().displayCurrency).toBe('BRL');
  });

  it('cada cuenta tiene la suya: no se comparte entre usuarios del mismo device', () => {
    const s = createSettingsStore();
    s.getState().setDisplayCurrency('BRL');

    useAuthStore.setState({ currentUser: user('u2') });
    s.getState().hydrate();
    expect(s.getState().displayCurrency).toBe('ARS'); // u2 nunca eligio

    s.getState().setDisplayCurrency('CLP');
    useAuthStore.setState({ currentUser: user('u1') });
    s.getState().hydrate();
    expect(s.getState().displayCurrency).toBe('BRL'); // u1 conserva la suya
  });

  it('un valor guardado que ya no es una moneda soportada cae al default', () => {
    const s = createSettingsStore();
    s.getState().setDisplayCurrency('BRL');
    // simula data vieja/corrupta escrita a mano
    s.getState().setDisplayCurrency('XXX' as never);
    const s2 = createSettingsStore();
    s2.getState().hydrate();
    expect(s2.getState().displayCurrency).toBe('ARS');
  });
});
