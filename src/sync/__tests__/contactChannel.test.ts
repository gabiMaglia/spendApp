import {
  ensureContactSecret, myContactCard, announceContact, drainContacts,
  deriveContactTopic, savePeer, peerSecret, listPeers, sendGroupKey,
} from '../contactChannel';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { ensureIdentity, ensureWrapKeypair } from '@/src/store/identityStore';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { openEnvelope, sealEnvelope, fromHex } from '../envelopeCrypto';
import * as Crypto from 'expo-crypto';
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

// --- alternancia de dispositivos ---------------------------------------------
// El secreto y los contactos están scopeados por cuenta, pero la identidad del
// dispositivo y las claves de grupo NO — son del aparato. Si no se guardaran y
// restauraran acá, los dos "teléfonos" compartirían identidad y el test no
// podría distinguir a Ana de Carla, que es justo lo que hay que verificar.

const CLAVES_DISPOSITIVO = ['identity_v1', 'wrapkeys_v1'];

type Dispositivo = {
  storage: Record<string, string | undefined>;
  keys: { groupId: string; key: string; epoch: number }[];
};

const dispositivos = new Map<string, Dispositivo>();
let actual: string | null = null;

/** Cambia de dispositivo/cuenta. El primero de cada uno arranca en blanco. */
function usar(me: User): void {
  const store = createSecureStorage('groupkeys');

  if (actual) {
    dispositivos.set(actual, {
      storage: Object.fromEntries(CLAVES_DISPOSITIVO.map(k => [k, store.getString(k)])),
      keys: useGroupKeyStore.getState().keys,
    });
  }

  for (const k of CLAVES_DISPOSITIVO) store.delete(k);
  const guardado = dispositivos.get(me.id);
  if (guardado) {
    for (const [k, v] of Object.entries(guardado.storage)) if (v !== undefined) store.set(k, v);
    useGroupKeyStore.setState({ keys: guardado.keys });
  } else {
    useGroupKeyStore.setState({ keys: [] });
  }

  useAuthStore.setState({ currentUser: me });
  useUserStore.setState({ users: [me] });
  actual = me.id;
}

beforeEach(() => {
  relayMock.__reset();
  createSecureStorage('users').clearAll();
  createSecureStorage('groupkeys').clearAll();
  useGroupKeyStore.setState({ keys: [] });
  dispositivos.clear();
  actual = null;
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
    savePeer('u-beto', { secret: 'sec-beto' });
    savePeer('u-carla', { secret: 'sec-carla' });

    expect(peerSecret('u-beto')).toBe('sec-beto');
    expect(Object.keys(listPeers())).toHaveLength(2);
  });

  it('un secreto vacío no se guarda', () => {
    usar(ANA);
    savePeer('u-beto', { secret: '' });

    expect(peerSecret('u-beto')).toBeUndefined();
  });

  it('no se mezclan entre cuentas', () => {
    usar(ANA);
    savePeer('u-beto', { secret: 'sec-beto' });

    usar(BETO);
    expect(peerSecret('u-beto')).toBeUndefined();
  });
});

describe('crear un grupo con un contacto: le llega solo', () => {
  /** Ana y Beto ya se escanearon: cada uno tiene el buzón y las claves del otro. */
  async function yaSonContactos(): Promise<{ deAna: string; deBeto: string }> {
    usar(ANA);
    const deAna = ensureContactSecret()!;
    const tarjetaDeAna = myContactCard()!;

    usar(BETO);
    const deBeto = ensureContactSecret()!;
    // Beto escaneó el código de Ana: guarda sus claves y le deja la suya.
    savePeer(ANA.id, {
      secret: deAna,
      wrapPublicKey: tarjetaDeAna.wrapPublicKey,
      identityPublicKey: tarjetaDeAna.identityPublicKey,
    });
    await announceContact(deAna, 'dev-beto');

    usar(ANA);
    await drainContacts(deAna, 'dev-ana', 0);   // Ana recoge la tarjeta de Beto

    return { deAna, deBeto };
  }

  it('Beto termina con la clave del grupo sin hacer nada', async () => {
    const { deBeto } = await yaSonContactos();

    usar(ANA);
    const clave = useGroupKeyStore.getState().ensureKey('g1').key;
    expect(await sendGroupKey(BETO.id, { id: 'g1', name: 'Viaje' }, 'dev-ana')).toBe(true);

    usar(BETO);
    const r = await drainContacts(deBeto, 'dev-beto', 0);

    expect(r.joinedGroups).toEqual(['g1']);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(clave);
  });

  it('la clave del grupo NO viaja en claro por el relay', async () => {
    const { deBeto } = await yaSonContactos();

    usar(ANA);
    const clave = useGroupKeyStore.getState().ensureKey('g1').key;
    await sendGroupKey(BETO.id, { id: 'g1', name: 'Viaje' }, 'dev-ana');

    const topic = await deriveContactTopic(deBeto);
    const sobre = relayMock.__buzones.get(topic)!.at(-1)!;

    expect(sobre.payload).not.toContain(clave);
  });

  it('a alguien que no es contacto no se le manda nada', async () => {
    usar(ANA);
    useGroupKeyStore.getState().ensureKey('g1');

    expect(await sendGroupKey('u-desconocido', { id: 'g1', name: 'Viaje' }, 'dev-ana')).toBe(false);
  });

  it('sin la clave del grupo no hay nada que entregar', async () => {
    await yaSonContactos();
    usar(ANA);
    useGroupKeyStore.setState({ keys: [] });

    expect(await sendGroupKey(BETO.id, { id: 'g1', name: 'Viaje' }, 'dev-ana')).toBe(false);
  });

  // La clave del buzón la conoce TODO el que haya escaneado ese código alguna
  // vez. Sin firma verificada contra la identidad que guardamos de esa persona,
  // cualquiera de ellos podría meter una clave inventada.
  it('una clave firmada por otro se rechaza', async () => {
    const { deBeto } = await yaSonContactos();

    // Carla también escaneó a Beto, así que conoce su buzón. Intenta pasarle
    // una clave haciéndose pasar por Ana.
    usar(usuario('u-carla', 'Carla'));
    savePeer(BETO.id, {
      secret: deBeto,
      wrapPublicKey: ensureWrapKeypair().publicKey,
      identityPublicKey: ensureIdentity().publicKey,
    });
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: 'ff'.repeat(32), epoch: 1 }] });
    await sendGroupKey(BETO.id, { id: 'g1', name: 'Trucho' }, 'dev-carla');

    usar(BETO);
    const r = await drainContacts(deBeto, 'dev-beto', 0);

    expect(r.joinedGroups).toEqual([]);
    expect(useGroupKeyStore.getState().getKey('g1')).toBeUndefined();
  });

  it('una clave que no es para mí se ignora', async () => {
    const { deBeto } = await yaSonContactos();

    usar(ANA);
    useGroupKeyStore.getState().ensureKey('g1');
    await sendGroupKey(BETO.id, { id: 'g1', name: 'Viaje' }, 'dev-ana');

    // Carla lee el buzón de Beto (lo conoce), pero la entrega no es para ella.
    usar(usuario('u-carla', 'Carla'));
    expect((await drainContacts(deBeto, 'dev-carla', 0)).joinedGroups).toEqual([]);
  });

  it('no se pisa una clave que ya teníamos', async () => {
    const { deBeto } = await yaSonContactos();

    usar(ANA);
    useGroupKeyStore.getState().ensureKey('g1');
    await sendGroupKey(BETO.id, { id: 'g1', name: 'Viaje' }, 'dev-ana');

    usar(BETO);
    const propia = useGroupKeyStore.getState().ensureKey('g1').key;
    const r = await drainContacts(deBeto, 'dev-beto', 0);

    expect(r.joinedGroups).toEqual([]);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(propia);
  });
});

describe('claves de grupo: lo que NO se acepta', () => {
  /** La misma derivación del módulo, para poder alterar un sobre sellado. */
  async function claveDelBuzon(secret: string): Promise<Uint8Array> {
    const hex = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `splitp2p/contact/v1:${secret}`,
    );
    return fromHex(hex.slice(0, 64));
  }

  /** Reemplaza el último sobre del buzón por una versión alterada del mensaje. */
  async function alterar(
    secret: string,
    cambios: Record<string, unknown>,
  ): Promise<void> {
    const topic = await deriveContactTopic(secret);
    const key = await claveDelBuzon(secret);
    const sobres = relayMock.__buzones.get(topic)!;
    const ultimo = sobres.at(-1)!;

    const msg = JSON.parse(openEnvelope(key, ultimo.payload)!) as Record<string, unknown>;
    ultimo.payload = sealEnvelope(key, JSON.stringify({ ...msg, ...cambios }));
  }

  async function anaYBetoSeEscanearon(): Promise<{ deAna: string; deBeto: string }> {
    usar(ANA);
    const deAna = ensureContactSecret()!;
    const tarjetaDeAna = myContactCard()!;

    usar(BETO);
    const deBeto = ensureContactSecret()!;
    savePeer(ANA.id, {
      secret: deAna,
      wrapPublicKey: tarjetaDeAna.wrapPublicKey,
      identityPublicKey: tarjetaDeAna.identityPublicKey,
    });
    await announceContact(deAna, 'dev-beto');

    usar(ANA);
    await drainContacts(deAna, 'dev-ana', 0);
    return { deAna, deBeto };
  }

  /**
   * La firma cubre el groupId. Alterarlo deja la clave envuelta intacta —así que
   * se descifra perfecto— y el ÚNICO obstáculo que queda es la firma. Sin esto
   * el atacante redirige una clave legítima a un grupo que él controla.
   */
  it('cambiar el grupo de una entrega la invalida', async () => {
    const { deBeto } = await anaYBetoSeEscanearon();

    usar(ANA);
    useGroupKeyStore.getState().ensureKey('g1');
    await sendGroupKey(BETO.id, { id: 'g1', name: 'Viaje' }, 'dev-ana');

    await alterar(deBeto, { groupId: 'g-trucho' });

    usar(BETO);
    const r = await drainContacts(deBeto, 'dev-beto', 0);

    expect(r.joinedGroups).toEqual([]);
    expect(useGroupKeyStore.getState().getKey('g-trucho')).toBeUndefined();
  });

  /**
   * La entrega tiene que venir del MISMO dispositivo que escaneamos, no apenas
   * de alguien que figure en la agenda. Caso real: la otra persona reinstaló la
   * app y tiene identidad nueva — la firma es válida, pero ya no es la que
   * verificamos en persona, así que no alcanza.
   */
  it('una entrega firmada con una identidad distinta a la que escaneamos se rechaza', async () => {
    const { deAna, deBeto } = await anaYBetoSeEscanearon();

    // Beto tiene a Ana en la agenda, pero con OTRA identidad (la de antes).
    usar(BETO);
    savePeer(ANA.id, { secret: deAna, identityPublicKey: 'ab'.repeat(32) });

    usar(ANA);
    useGroupKeyStore.getState().ensureKey('g1');
    await sendGroupKey(BETO.id, { id: 'g1', name: 'Viaje' }, 'dev-ana');

    usar(BETO);
    const r = await drainContacts(deBeto, 'dev-beto', 0);

    expect(r.joinedGroups).toEqual([]);
    expect(useGroupKeyStore.getState().getKey('g1')).toBeUndefined();
  });

  it('a un contacto del que no conocemos su pública no se le manda nada', async () => {
    usar(BETO);
    const deBeto = ensureContactSecret()!;

    usar(ANA);
    savePeer(BETO.id, { secret: deBeto }); // sin wrapPublicKey
    useGroupKeyStore.getState().ensureKey('g1');

    expect(await sendGroupKey(BETO.id, { id: 'g1', name: 'Viaje' }, 'dev-ana')).toBe(false);
  });
});
