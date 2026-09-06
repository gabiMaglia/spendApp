let mockRelayConfigurado = true;

jest.mock('@/src/sync/relay', () => ({
  isRelayConfigured: () => mockRelayConfigurado,
  getRelayClient: () => null,
}));

import {
  useAuthStore, marcarProveedorProbado, olvidarPruebasDeProveedor,
} from '../authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';

/**
 * T-042 · Fusionar dos cuentas exige una prueba, no un toque en un `Alert`.
 *
 * **El ataque que esto cierra:** alguien agarra el teléfono desbloqueado en la
 * pantalla de login, entra con SU cuenta de Google, la app le ofrece unirla con
 * la del dueño —porque sin el mail no puede distinguirlas— y con un «sí» se
 * lleva una copia de todo. `mergeAccounts` es una unión y **no borra el
 * origen**, así que el atacante se queda con los datos.
 *
 * Lo que ahora se exige: que **esta sesión** haya probado contra el directorio
 * el proveedor de la cuenta DESTINO. El atacante puede probar el suyo —entra
 * con su Google— pero no el de la víctima, que es todo el punto.
 */
const auth = createSecureStorage('auth');

const DUENIO = 'apple:duenio';
const ATACANTE = 'google:atacante';

function indiceDelDuenio(): void {
  auth.set(`acct::p:${DUENIO}`, 'cuentaA');
}

function apuntaA(providerId: string): string | undefined {
  return auth.getString(`acct::p:${providerId}`);
}

beforeEach(() => {
  auth.clearAll();
  olvidarPruebasDeProveedor();
  mockRelayConfigurado = true;
  indiceDelDuenio();
});

describe('el ataque del teléfono desbloqueado', () => {
  it('SIN prueba de la cuenta destino, no fusiona', () => {
    const r = useAuthStore.getState().confirmAccountLink(ATACANTE, 'cuentaA');

    expect(r).toEqual({ ok: false, reason: 'sin_prueba' });
    // Y no dejó rastro: el proveedor del atacante NO quedó apuntando a la
    // cuenta del dueño. Sin este assert, el test pasaría con una fusión hecha.
    expect(apuntaA(ATACANTE)).toBeUndefined();
  });

  it('probar el proveedor PROPIO no alcanza: se exige el de la cuenta destino', () => {
    // Es exactamente lo que el atacante SÍ puede hacer: entrar con su Google.
    marcarProveedorProbado(ATACANTE);

    const r = useAuthStore.getState().confirmAccountLink(ATACANTE, 'cuentaA');

    expect(r).toEqual({ ok: false, reason: 'sin_prueba' });
    expect(apuntaA(ATACANTE)).toBeUndefined();
  });

  it('probado el proveedor del dueño, la fusión legítima ocurre', () => {
    marcarProveedorProbado(DUENIO);

    const r = useAuthStore.getState().confirmAccountLink('google:elmismo', 'cuentaA');

    expect(r).toEqual({ ok: true, probado: true });
    expect(apuntaA('google:elmismo')).toBe('cuentaA');
  });

  it('la prueba muere con la sesión', () => {
    // Heredarla sería dejarle al próximo que agarre el teléfono la credencial
    // del anterior.
    marcarProveedorProbado(DUENIO);
    useAuthStore.getState().signOut();
    indiceDelDuenio();   // el signOut no toca el índice, pero sí el storage de sesión

    const r = useAuthStore.getState().confirmAccountLink(ATACANTE, 'cuentaA');

    expect(r).toEqual({ ok: false, reason: 'sin_prueba' });
  });
});

describe('el degradado sin directorio', () => {
  it('sin relay configurado se fusiona igual, y el resultado lo declara', () => {
    // Decisión declarada: una app offline-first no puede exigir red para
    // entrar. El ataque sigue disponible en ese caso, y queda escrito en vez
    // de disimulado.
    mockRelayConfigurado = false;

    const r = useAuthStore.getState().confirmAccountLink(ATACANTE, 'cuentaA');

    expect(r).toEqual({ ok: true, probado: false });
    expect(apuntaA(ATACANTE)).toBe('cuentaA');
  });
});

describe('lo que el camino sin prueba NO puede hacer', () => {
  it('«mantenerlas separadas» es permanente, y por eso no es el fallback', () => {
    // `keepSeparate` apunta el proveedor a su propia cuenta: el próximo login
    // ya no pregunta nada. Si el camino «sin prueba» cayera acá, una fusión
    // legítima quedaría imposible para siempre y el usuario no tendría forma
    // de volver a intentarla.
    useAuthStore.getState().keepAccountSeparate('google:otro', 'otro@x.com');
    expect(apuntaA('google:otro')).toBe('google:otro');
  });
});
