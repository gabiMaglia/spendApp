/**
 * T-147 (R4-3, ronda 4) · «sin aviso falso tras un login OK».
 *
 * `setUser` (con `authProvider` ya puesto) dispara `startRelay` — que llama a
 * `ensureRelaySession()`— ANTES de que `entrarAlDirectorio` (`auth/index.tsx`,
 * líneas 300-309 para Apple) llegue a llamar a `signIntoDirectory`. Las dos
 * cosas pasan sin `await` entre medio (`void entrarAlDirectorio(...)`), así
 * que la primera lectura de sesión casi siempre ve "todavía no hay nada"
 * (`'none'`) — un login que en realidad va a salir bien.
 *
 * Este suite NO mockea `relaySession` (a diferencia de `relayEngineSesion.test.ts`):
 * usa la cola real (`encolarOperacionDeSesion`) contra un cliente de Supabase
 * de juguete, para reproducir el ORDEN real en vez de simularlo con un mock
 * que decida el resultado de antemano.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prueba.local';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba';

/** Prefijo `mock` obligatorio: `jest.mock` hoistea por encima de este `let`,
 *  pero como `getRelayClient` sólo LEE `.current` cuando se lo LLAMA (no al
 *  registrar el mock), alcanza con que esté asignado antes de que el test
 *  corra — no antes de que el factory se declare. */
let mockClienteRef: { current: unknown } = { current: null };

// `getRelayClient` NO es null acá (a diferencia de `relayEngineSesion.test.ts`):
// `directoryAuth.signIntoDirectory` y `relaySession` lo necesitan de verdad
// para poder correr la cola real contra el mismo cliente de juguete.
jest.mock('../relay', () => ({
  isRelayConfigured: () => true,
  subscribeTopic: jest.fn(() => () => {}),
  sendEnvelope: jest.fn(async () => ({ ok: true, seq: 1 })),
  fetchSince: jest.fn(async () => ({ ok: true, envelopes: [], cursor: 0, more: false })),
  deleteMyEnvelopes: jest.fn(async () => ({ ok: true, deleted: 0 })),
  getRelayClient: () => mockClienteRef.current,
  esFuncionAusente: () => false,
}));
jest.mock('../inviteEngine', () => ({
  activeInvites: () => [],
  processInvite: jest.fn(async () => [] as string[]),
  processAllInvites: jest.fn(async () => [] as string[]),
}));
jest.mock('../contactChannel', () => ({
  ensureContactSecret: () => null,
  deriveContactTopic: jest.fn(async () => 'topic-contactos'),
  drainContacts: jest.fn(async () => ({ cursor: 0, added: 0, joinedGroups: [], conflictedGroups: [] })),
  sendGroupKey: jest.fn(async () => true),
  sendGroupKeyResultado: jest.fn(async () => ({ ok: true, seq: 1 })),
  announceContact: jest.fn(async () => true),
  announceContactResultado: jest.fn(async () => ({ ok: true, seq: 1 })),
  listPeers: () => ({}),
  myContactCard: () => null,
  cardFingerprint: () => '',
  cardYaEnviada: () => false,
  marcarCardEnviada: () => {},
}));
jest.mock('../contactInviteEngine', () => ({ processAllContactInvites: jest.fn(async () => false) }));

let sesion: { user: { is_anonymous?: boolean; id?: string } } | null = null;
const signInAnonymously = jest.fn(async () => ({ data: { session: null }, error: { message: 'no debería llamarse' } }));
/** El login real: se resuelve recién cuando el test lo libera (`liberarLogin`) — modela la red. */
let liberarLogin: (() => void) | null = null;
const signInWithIdToken = jest.fn(() => new Promise(resolve => {
  liberarLogin = () => {
    sesion = { user: { is_anonymous: false, id: 'uid-apple-1' } };
    resolve({ data: { session: sesion }, error: null });
  };
}));
const signOut = jest.fn(async () => ({ error: null }));
const mockCliente = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: sesion }, error: null })),
    signInAnonymously,
    signInWithIdToken,
    signOut,
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
};
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockCliente),
}));
mockClienteRef.current = mockCliente;
jest.mock('../captchaBridge', () => ({ requestCaptchaToken: jest.fn(async () => ({ status: 'not_required' })) }));
jest.mock('../accountReconnectBridge', () => ({ requestReconnect: jest.fn(async () => ({ status: 'not_available' })) }));

import { startRelay, stopRelay } from '../relayEngine';
import { sinSesionDeSync, __resetSessionStatus } from '../sessionStatus';
import { signIntoDirectory } from '../directoryAuth';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

beforeEach(() => {
  sesion = null;
  liberarLogin = null;
  signInAnonymously.mockClear();
  signInWithIdToken.mockClear();
  signOut.mockClear();
  __resetSessionStatus();
  useAuthStore.setState({ currentUser: null });
});

afterEach(() => {
  stopRelay();
});

describe('R4-3: sin aviso falso durante (ni justo después de) un login OK', () => {
  it('orden real (auth/index.tsx:300-309): setUser + startRelay ANTES de que signIntoDirectory resuelva — nunca se reporta "sin sesión"', async () => {
    // `setUser` — el authProvider ya viene puesto, como en el callback real.
    useAuthStore.setState({ currentUser: { id: 'acc-apple', authProvider: 'apple' } as User });

    // `startRelay` (disparado por el mismo efecto que reacciona a `setUser`),
    // SIN await — igual que el efecto real no espera a la cadena entera.
    const cadena = startRelay();

    // `void entrarAlDirectorio('apple', credential.identityToken, ...)` —
    // la línea siguiente en `auth/index.tsx`, también sin await entre medio.
    const login = signIntoDirectory('apple', 'tok-apple');

    // Mientras el login sigue en vuelo (todavía no se liberó `signInWithIdToken`),
    // la cadena de sync ya debería haber intentado leer la sesión al menos
    // una vez — y NO tiene que haber quedado marcada como "sin sesión".
    for (let i = 0; i < 20 && !signInWithIdToken.mock.calls.length; i++) await Promise.resolve();
    expect(signInWithIdToken).toHaveBeenCalled(); // el login ya entró a la cola, sigue sin resolver
    expect(sinSesionDeSync()).toBe(false);

    // Ahora sí se libera el login (la red "contesta").
    liberarLogin!();
    await login;
    await cadena;

    // Con el login ya resuelto, tampoco queda ningún aviso falso pegado.
    expect(sinSesionDeSync()).toBe(false);
  });
});
