import {
  ensureContactSecret, myContactCard, announceContact, drainContacts,
  deriveContactTopic, savePeerSecret, peerSecret, listPeerSecrets,
} from '../contactChannel';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { openEnvelope, fromHex } from '../envelopeCrypto';
import type { User } from '@/src/types/models';

/**
 * Agregar un contacto tiene que quedar en LOS DOS teléfonos con un solo
 * escaneo. Eso es lo que se verifica acá: Beto escanea el código de Ana, y Ana
 * termina teniendo a Beto sin haber tocado nada.
 *
 * Los dos dispositivos se simulan alternando la cuenta activa: el secreto y los
 * contactos están scopeados por cuenta, así que cambiar de cuenta ya cambia de
 * "teléfono" a los efectos de este módulo.
 */

jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; created_at: string }[]>();
  let seq = 0;

  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string) => {
      const lista = buzones.get(topic) ?? [];
      lista.push({ seq: ++seq, topic, payload, sender, created_at: '' });
      buzones.set(topic, lista);
      return { ok: true, seq };
    },
    fetchSince: async (topic: string, since: number, exclude?: string) => {
      const todos = (buzones.get(topic) ?? [])
        .filter(e => e.seq > since && (!exclude || e.sender !== exclude));
      return {
        ok: true,
        envelopes: todos,
        cursor: todos.length > 0 ? todos[todos.length - 1]!.seq : since,
      };
    },
  };
});

const relayMock = jest.requireMock('../relay') as {
  __buzones: Map<string, { seq: number; payload: string; sender: string }[]>;
  __reset: () => void;
};

const ANA  = usuario('u-ana', 'Ana');
const BETO = usuario('u-beto', 'Beto');

function usuario(id: string, name: string): User {
  return {
    id, name, email: `${id}@test.com`, authProvider: 'google',
    createdAt: 0, updatedAt: 0, isDeleted: false,
  };
}

/** Cambia de cuenta activa: cada una tiene su secreto y sus contactos. */
function usar(me: User): void {
  useAuthStore.setState({ currentUser: me });
  useUserStore.setState({ users: [me] });
}

beforeEach(() => {
  relayMock.__reset();
  createSecureStorage('users').clearAll();
  useUserStore.setState({ users: [] });
  useAuthStore.setState({ currentUser: null });
});

describe('un escaneo, contacto en los dos teléfonos', () => {
  it('quien muestra el código termina teniendo al que escaneó', async () => {
    usar(ANA);
    const secretoDeAna = ensureContactSecret()!;   // lo que va en su QR

    // Beto escanea: guarda a Ana y le deja su tarjeta.
    usar(BETO);
    expect(await announceContact(secretoDeAna, 'dev-beto')).toBe(true);

    // Ana no hace nada: la app recoge sola.
    usar(ANA);
    const r = await drainContacts(secretoDeAna, 'dev-ana', 0);

    expect(r.added).toBe(1);
    expect(useUserStore.getState().getUserById(BETO.id)?.name).toBe('Beto');
  });

  it('el canal queda mutuo: Ana se guarda el secreto de Beto', async () => {
    usar(ANA);
    const secretoDeAna = ensureContactSecret()!;

    usar(BETO);
    const secretoDeBeto = ensureContactSecret()!;
    await announceContact(secretoDeAna, 'dev-beto');

    usar(ANA);
    await drainContacts(secretoDeAna, 'dev-ana', 0);

    expect(peerSecret(BETO.id)).toBe(secretoDeBeto);
  });

  it('el secreto es estable: un QR mostrado dos veces sirve igual', () => {
    usar(ANA);
    expect(ensureContactSecret()).toBe(ensureContactSecret());
  });

  it('cada cuenta tiene el suyo', () => {
    usar(ANA);
    const deAna = ensureContactSecret();
    usar(BETO);

    expect(ensureContactSecret()).not.toBe(deAna);
  });

  it('el cursor avanza y no se reprocesa lo ya recogido', async () => {
    usar(ANA);
    const secretoDeAna = ensureContactSecret()!;

    usar(BETO);
    await announceContact(secretoDeAna, 'dev-beto');

    usar(ANA);
    const primera = await drainContacts(secretoDeAna, 'dev-ana', 0);
    const segunda = await drainContacts(secretoDeAna, 'dev-ana', primera.cursor);

    expect(primera.added).toBe(1);
    expect(segunda.added).toBe(0);
  });

  it('sin sesión no se anuncia ni se recoge nada', async () => {
    usar(ANA);
    const secretoDeAna = ensureContactSecret()!;

    useAuthStore.setState({ currentUser: null });

    expect(ensureContactSecret()).toBeNull();
    expect(await announceContact(secretoDeAna, 'dev-x')).toBe(false);
    expect((await drainContacts(secretoDeAna, 'dev-x', 0)).added).toBe(0);
  });
});

describe('lo que el buzón de contactos no filtra', () => {
  // El topic viaja en claro hasta el servidor. Si la clave saliera de la misma
  // derivación, el servidor podría leer quién agrega a quién.
  it('EL TOPIC NO SIRVE COMO CLAVE PARA ABRIR LAS TARJETAS', async () => {
    usar(ANA);
    const secretoDeAna = ensureContactSecret()!;

    usar(BETO);
    await announceContact(secretoDeAna, 'dev-beto');

    const topic = await deriveContactTopic(secretoDeAna);
    const sobre = relayMock.__buzones.get(topic)![0]!;

    expect(openEnvelope(fromHex(topic.slice(0, 64)), sobre.payload)).toBeNull();
  });

  it('el nombre no viaja en claro por el relay', async () => {
    usar(ANA);
    const secretoDeAna = ensureContactSecret()!;

    usar(BETO);
    await announceContact(secretoDeAna, 'dev-beto');

    const topic = await deriveContactTopic(secretoDeAna);
    const sobre = relayMock.__buzones.get(topic)![0]!;

    expect(sobre.payload).not.toContain('Beto');
    expect(sobre.payload).not.toContain(BETO.id);
  });

  it('basura en el buzón se saltea sin frenar la cola', async () => {
    usar(ANA);
    const secretoDeAna = ensureContactSecret()!;
    const topic = await deriveContactTopic(secretoDeAna);

    usar(BETO);
    await announceContact(secretoDeAna, 'dev-beto');
    relayMock.__buzones.get(topic)!.unshift({ seq: 0, payload: 'no soy una tarjeta', sender: 'dev-x' });

    usar(ANA);
    expect((await drainContacts(secretoDeAna, 'dev-ana', -1)).added).toBe(1);
  });

  it('sin el secreto no se puede leer el buzón de otro', async () => {
    usar(ANA);
    const secretoDeAna = ensureContactSecret()!;

    usar(BETO);
    const secretoDeBeto = ensureContactSecret()!;
    await announceContact(secretoDeAna, 'dev-beto');

    // Carla intenta leer el buzón de Ana con SU propio secreto.
    usar(usuario('u-carla', 'Carla'));
    expect((await drainContacts(secretoDeBeto, 'dev-carla', 0)).added).toBe(0);
  });
});

describe('tarjeta propia', () => {
  it('lleva quién soy y mi secreto', () => {
    usar(ANA);
    const card = myContactCard()!;

    expect(card).toMatchObject({ kind: 'contact', userId: ANA.id, name: 'Ana' });
    expect(card.contactSecret).toBe(ensureContactSecret());
  });

  it('sin sesión no hay tarjeta', () => {
    expect(myContactCard()).toBeNull();
  });
});

describe('secretos de contactos guardados', () => {
  it('se guardan por usuario y sobreviven', () => {
    usar(ANA);
    savePeerSecret('u-beto', 'sec-beto');
    savePeerSecret('u-carla', 'sec-carla');

    expect(peerSecret('u-beto')).toBe('sec-beto');
    expect(Object.keys(listPeerSecrets())).toHaveLength(2);
  });

  it('un secreto vacío no se guarda', () => {
    usar(ANA);
    savePeerSecret('u-beto', '');

    expect(peerSecret('u-beto')).toBeUndefined();
  });

  it('no se mezclan entre cuentas', () => {
    usar(ANA);
    savePeerSecret('u-beto', 'sec-beto');

    usar(BETO);
    expect(peerSecret('u-beto')).toBeUndefined();
  });
});
