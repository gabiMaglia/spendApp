import {
  ensureContactSecret, myContactCard, announceContact, drainContacts,
  deriveContactTopic, savePeer, peerSecret, listPeers, sendGroupKey,
  getPeer, peersIncompletos, hasConflictingPinnedKeys,
} from '../contactChannel';
import { ofertasDe } from '../groupKeyOffers';
import { avisarConflictosDelDrenaje } from '../keyConflictNotice';
import { estaPendienteDeDrenaje } from '../pendingDrain';
import { elegirClaveDeGrupo } from '@/src/services/elegirClaveDeGrupo';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { ensureIdentity, ensureWrapKeypair } from '@/src/store/identityStore';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { openEnvelope, sealEnvelope, fromHex } from '../envelopeCrypto';
import * as Crypto from 'expo-crypto';
import type { KeyConflictNotice } from '@/src/services/syncNotices';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
// `keyConflictNotice` → `groupStore` → `relayEngine`: se corta acá para que el
// motor real no arranque en los tests del canal.
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', olvidarCursor: jest.fn(),
  publishNow: jest.fn(async () => {}), drainNow: jest.fn(async () => 0), startRelay: jest.fn(async () => {}),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => {},
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  scheduleNotificationAsync: async () => 'id',
}));

const relayEngineMock = jest.requireMock('@/src/sync/relayEngine') as { drainNow: jest.Mock };

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
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; created_at: string; compactable?: boolean }[]>();
  let seq = 0;

  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false) => {
      const lista = buzones.get(topic) ?? [];
      lista.push({ seq: ++seq, topic, payload, sender, created_at: '', compactable });
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
  __buzones: Map<string, { seq: number; payload: string; sender: string; compactable?: boolean }[]>;
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

  // SEC H-1: la tarjeta ya no manda email (ver "tarjeta propia"), así que un
  // contacto nuevo por relay queda sin mail — no hay de dónde sacarlo, y no es
  // un dato que haga falta para nada del lado del receptor.
  it('un contacto nuevo por relay queda sin email: la tarjeta no lo trae', async () => {
    usar(ANA);
    const secretoDeAna = ensureContactSecret()!;

    usar(BETO);
    await announceContact(secretoDeAna, 'dev-beto');

    usar(ANA);
    await drainContacts(secretoDeAna, 'dev-ana', 0);

    expect(useUserStore.getState().getUserById(BETO.id)?.email).toBe('');
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

  // SEC H-1: `announceContact` manda esta tarjeta al buzón de quien haya
  // escaneado/linkeado el código — hoy incluye mail, avatar, secreto y
  // públicas. El mail no tiene por qué viajar: T-077 ya declara "no
  // recolectado", así que la tarjeta tiene que cumplirlo de verdad.
  it('NO LLEVA EL EMAIL', () => {
    usar(ANA);
    const card = myContactCard()!;

    expect(card).not.toHaveProperty('email');
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

  // T-132 criterio 4 (`qa/SEC3-2026-09-14.md`, nota de alcance sobre
  // `contactChannel.ts:279`): S3-A1 sustituye una clave EXISTENTE porque
  // `groupKeyStore.adoptKeys` compara épocas cuando ya hay un registro para ese
  // `groupId`. Acá el guard de `adoptDroppedKey` (`contactChannel.ts:271`,
  // `if (useGroupKeyStore.getState().getKey(drop.groupId)) return false`)
  // corta ANTES de llegar a `adoptKeys` si ya tenemos la clave — así que ese
  // branch de comparación de épocas nunca se ejecuta desde este canal, sea cual
  // sea la época que traiga el mensaje. No es "lo mismo que S3-A1": no hay
  // sustitución posible, con época absurda o sin ella.
  it('una época absurda en el mensaje NO alcanza para sustituir una clave que ya tenemos', async () => {
    const { deBeto } = await yaSonContactos();

    usar(ANA);
    useGroupKeyStore.getState().ensureKey('g1'); // época 1
    await sendGroupKey(BETO.id, { id: 'g1', name: 'Viaje' }, 'dev-ana');

    usar(BETO);
    const propia = useGroupKeyStore.getState().ensureKey('g1'); // Beto ya la tiene
    await drainContacts(deBeto, 'dev-beto', 0); // se descarta por "ya la teníamos"

    // Ana (o un cliente modificado que se hace pasar por ella, firmando con su
    // identidad real) sube su propia época a un valor absurdo y reenvía.
    usar(ANA);
    useGroupKeyStore.setState({
      keys: useGroupKeyStore.getState().keys.map(k => k.groupId === 'g1' ? { ...k, epoch: 1e9 } : k),
    });
    await sendGroupKey(BETO.id, { id: 'g1', name: 'Viaje' }, 'dev-ana');

    usar(BETO);
    const r = await drainContacts(deBeto, 'dev-beto', 1); // sólo el segundo envío

    expect(r.joinedGroups).toEqual([]);
    expect(useGroupKeyStore.getState().getKey('g1')).toEqual(propia);
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

describe('reparación de contactos incompletos', () => {
  it('los contactos sin claves públicas quedan listados para completar', () => {
    usar(ANA);
    savePeer('u-viejo', { secret: 'sec-viejo' });                       // agregado antes
    savePeer('u-nuevo', { secret: 'sec-nuevo', wrapPublicKey: 'cd'.repeat(32) });

    expect(peersIncompletos()).toEqual(['sec-viejo']);
  });

  it('recibir una tarjeta completa los huecos', async () => {
    usar(ANA);
    const deAna = ensureContactSecret()!;

    usar(BETO);
    await announceContact(deAna, 'dev-beto');

    usar(ANA);
    savePeer(BETO.id, { secret: 'viejo-sin-claves' }); // como quedó de antes
    await drainContacts(deAna, 'dev-ana', 0);

    expect(getPeer(BETO.id)?.wrapPublicKey).toBeTruthy();
    expect(peersIncompletos()).toEqual([]);
  });

  it('al completarse, se le devuelve la tarjeta propia para que el otro también complete', async () => {
    usar(ANA);
    const deAna = ensureContactSecret()!;

    usar(BETO);
    const deBeto = ensureContactSecret()!;
    await announceContact(deAna, 'dev-beto');

    usar(ANA);
    await drainContacts(deAna, 'dev-ana', 0);

    const topicDeBeto = await deriveContactTopic(deBeto);
    expect(relayMock.__buzones.get(topicDeBeto) ?? []).toHaveLength(1);
  });

  it('no hay ida y vuelta infinita: el que ya tenía las claves no responde', async () => {
    usar(ANA);
    const deAna = ensureContactSecret()!;
    const tarjetaDeAna = myContactCard()!;

    // Beto escaneó a Ana, así que YA tiene sus claves.
    usar(BETO);
    const deBeto = ensureContactSecret()!;
    savePeer(ANA.id, {
      secret: deAna,
      wrapPublicKey: tarjetaDeAna.wrapPublicKey,
      identityPublicKey: tarjetaDeAna.identityPublicKey,
    });
    await announceContact(deAna, 'dev-beto');

    usar(ANA);
    await drainContacts(deAna, 'dev-ana', 0);      // Ana responde una vez

    usar(BETO);
    await drainContacts(deBeto, 'dev-beto', 0);    // Beto ya las tenía: no responde

    const topicDeAna = await deriveContactTopic(deAna);
    expect(relayMock.__buzones.get(topicDeAna)).toHaveLength(1); // sólo la original
  });

  /**
   * Una tarjeta la puede escribir cualquiera que conozca el buzón — o sea,
   * cualquiera que haya escaneado ese código. Si pudiera pisar claves ya
   * conocidas, uno de ellos se haría pasar por otro y recibiría claves de grupo
   * en su nombre.
   */
  it('UNA TARJETA NO PUEDE REEMPLAZAR CLAVES QUE YA TENÍAMOS', async () => {
    usar(ANA);
    const deAna = ensureContactSecret()!;
    savePeer(BETO.id, {
      secret: 'sec-beto',
      wrapPublicKey: 'aa'.repeat(32),
      identityPublicKey: 'bb'.repeat(32),
    });

    // Beto (o alguien con su buzón) manda una tarjeta con claves distintas.
    usar(BETO);
    await announceContact(deAna, 'dev-beto');

    usar(ANA);
    await drainContacts(deAna, 'dev-ana', 0);

    expect(getPeer(BETO.id)?.identityPublicKey).toBe('bb'.repeat(32));
    expect(getPeer(BETO.id)?.wrapPublicKey).toBe('aa'.repeat(32));
  });

  // Escanear en persona SÍ puede: es la forma de re-verificar a alguien que
  // reinstaló la app.
  it('volver a escanear sí actualiza las claves', () => {
    usar(ANA);
    savePeer(BETO.id, { secret: 's', wrapPublicKey: 'aa'.repeat(32) });
    savePeer(BETO.id, { secret: 's', wrapPublicKey: 'cc'.repeat(32) });

    expect(getPeer(BETO.id)?.wrapPublicKey).toBe('cc'.repeat(32));
  });
});

/**
 * T-093 / SEC H-1: el gate que usa `app/contact/add.tsx` ANTES de llamar a
 * `savePeer`, tanto para QR como para link. Es de lectura pura — no escribe.
 */
describe('hasConflictingPinnedKeys — detectar antes de pisar', () => {
  it('sin peer previo, nunca hay conflicto', () => {
    usar(ANA);
    expect(hasConflictingPinnedKeys(BETO.id, { secret: 's', identityPublicKey: 'bb'.repeat(32) })).toBe(false);
  });

  it('peer previo sin claves pinneadas: completar no es conflicto', () => {
    usar(ANA);
    savePeer(BETO.id, { secret: 's' }); // sin claves todavía

    expect(hasConflictingPinnedKeys(BETO.id, { secret: 's', identityPublicKey: 'bb'.repeat(32) })).toBe(false);
  });

  it('la MISMA clave pinneada que llega de nuevo no es conflicto', () => {
    usar(ANA);
    savePeer(BETO.id, { secret: 's', identityPublicKey: 'bb'.repeat(32), wrapPublicKey: 'cc'.repeat(32) });

    expect(hasConflictingPinnedKeys(BETO.id, {
      secret: 's', identityPublicKey: 'bb'.repeat(32), wrapPublicKey: 'cc'.repeat(32),
    })).toBe(false);
  });

  it('identidad distinta a la pinneada ES conflicto', () => {
    usar(ANA);
    savePeer(BETO.id, { secret: 's', identityPublicKey: 'bb'.repeat(32) });

    expect(hasConflictingPinnedKeys(BETO.id, { secret: 's', identityPublicKey: 'ff'.repeat(32) })).toBe(true);
  });

  it('pública de envoltura distinta a la pinneada ES conflicto', () => {
    usar(ANA);
    savePeer(BETO.id, { secret: 's', wrapPublicKey: 'cc'.repeat(32) });

    expect(hasConflictingPinnedKeys(BETO.id, { secret: 's', wrapPublicKey: 'ff'.repeat(32) })).toBe(true);
  });

  // Es el caso exacto de H-1: el contacto está borrado (tombstone) del lado del
  // userStore, pero el peer (sus claves) sigue vivo — nunca se limpia al borrar.
  it('un peer de un contacto YA BORRADO (tombstone) sigue protegido', () => {
    usar(ANA);
    savePeer(BETO.id, { secret: 's', identityPublicKey: 'bb'.repeat(32) });
    useUserStore.getState().removeUser(BETO.id); // tombstone: isDeleted:true, la clave del peer NO se toca

    expect(hasConflictingPinnedKeys(BETO.id, { secret: 's', identityPublicKey: 'ff'.repeat(32) })).toBe(true);
  });
});

describe('guardar contactos sin perder datos', () => {
  // Escanear un código viejo (sin claves) no puede hacernos perder las que ya
  // teníamos: quedaríamos sin poder entregarle nada y sin ningún síntoma.
  it('un campo vacío no borra lo que ya sabíamos', () => {
    usar(ANA);
    savePeer(BETO.id, {
      secret: 's', wrapPublicKey: 'aa'.repeat(32), identityPublicKey: 'bb'.repeat(32),
    });

    savePeer(BETO.id, { secret: 's', wrapPublicKey: undefined, identityPublicKey: '' });

    expect(getPeer(BETO.id)?.wrapPublicKey).toBe('aa'.repeat(32));
    expect(getPeer(BETO.id)?.identityPublicKey).toBe('bb'.repeat(32));
  });
});

/**
 * El buzón de contacto lleva MENSAJES distintos por el mismo canal y desde el
 * mismo remitente: una tarjeta y una entrega de clave de grupo. Marcarlos
 * compactables haría que la entrega borre la tarjeta que el otro todavía no
 * leyó — pérdida de datos silenciosa.
 */
describe('el buzón de contacto NO se compacta', () => {
  it('la tarjeta no se marca compactable', async () => {
    usar(ANA);
    const deAna = ensureContactSecret()!;

    usar(BETO);
    await announceContact(deAna, 'dev-beto');

    const sobre = relayMock.__buzones.get(await deriveContactTopic(deAna))![0]!;
    expect(sobre.compactable).toBe(false);
  });

  it('la entrega de clave tampoco', async () => {
    usar(BETO);
    const deBeto = ensureContactSecret()!;
    const tarjetaDeBeto = myContactCard()!;

    usar(ANA);
    savePeer(BETO.id, {
      secret: deBeto,
      wrapPublicKey: tarjetaDeBeto.wrapPublicKey,
      identityPublicKey: tarjetaDeBeto.identityPublicKey,
    });
    useGroupKeyStore.getState().ensureKey('g1');
    await sendGroupKey(BETO.id, { id: 'g1', name: 'Viaje' }, 'dev-ana');

    const sobres = relayMock.__buzones.get(await deriveContactTopic(deBeto))!;
    expect(sobres.every(s => s.compactable === false)).toBe(true);
  });
});

describe('ids hostiles en la tabla de peers (T-098 · SEC L-3)', () => {
  it('getPeer de nombres del prototipo no devuelve funciones', () => {
    usar(ANA);
    expect(getPeer('constructor')).toBeUndefined();
    expect(getPeer('toString')).toBeUndefined();
    expect(getPeer('__proto__')).toBeUndefined();
  });

  it('un peer con id "__proto__" se guarda y se lee como cualquier otro', () => {
    usar(ANA);
    savePeer('__proto__', { secret: 'ab'.repeat(32) });
    expect(getPeer('__proto__')?.secret).toBe('ab'.repeat(32));
    expect(getPeer('constructor')).toBeUndefined();
  });
});

/**
 * T-136 · ADR-013. «Peer» es cualquiera que haya escaneado mi QR: su firma
 * prueba quién manda, no que sea miembro del grupo. Mallory escaneó el QR de
 * Ana y no está en el grupo; Beto sí.
 */
describe('T-136 · claves distintas para el mismo grupo', () => {
  const MALLORY = usuario('u-mallory', 'Mallory');
  const FALSA = 'ab'.repeat(32);

  /** Beto y Mallory escanearon el QR de Ana, y Ana recogió las dos tarjetas. */
  async function anaTieneDosContactos(): Promise<{ deAna: string; cursor: number }> {
    usar(ANA);
    const deAna = ensureContactSecret()!;
    const tarjeta = myContactCard()!;
    for (const quien of [BETO, MALLORY]) {
      usar(quien);
      savePeer(ANA.id, {
        secret: deAna,
        wrapPublicKey: tarjeta.wrapPublicKey,
        identityPublicKey: tarjeta.identityPublicKey,
      });
      await announceContact(deAna, `dev-${quien.id}`);
    }
    usar(ANA);
    const r = await drainContacts(deAna, 'dev-ana', 0);
    return { deAna, cursor: r.cursor };
  }

  /** Mallory planta una clave suya para g1, con una época absurda. */
  async function malloryPlanta(): Promise<void> {
    usar(MALLORY);
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: FALSA, epoch: 1e9 }] });
    await sendGroupKey(ANA.id, { id: 'g1', name: 'Viaje' }, 'dev-mallory');
  }

  /** Beto, el miembro real, entrega la clave de verdad. */
  async function betoEntrega(): Promise<string> {
    usar(BETO);
    const clave = useGroupKeyStore.getState().ensureKey('g1').key;
    await sendGroupKey(ANA.id, { id: 'g1', name: 'Viaje' }, 'dev-beto');
    return clave;
  }

  /** Lo mismo que hace `relayEngine.drainContactsNow` con el resultado. */
  async function anaDrena(deAna: string, desde: number) {
    usar(ANA);
    const r = await drainContacts(deAna, 'dev-ana', desde);
    await avisarConflictosDelDrenaje(r);
    return r;
  }

  const conflictosDe = (groupId: string): KeyConflictNotice[] => useNoticeInboxStore.getState().items
    .map(i => i.notice)
    .filter((n): n is KeyConflictNotice => n.kind === 'group_key_conflict' && n.groupId === groupId);

  beforeEach(() => {
    createSecureStorage('notices').clearAll();
    useNoticeInboxStore.setState({ items: [] });
  });

  it('criterio 2 · mismo lote: claves distintas de dos remitentes → no se adopta ninguna y hay UN aviso', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    await malloryPlanta();
    await betoEntrega();

    const r = await anaDrena(deAna, cursor);

    expect(useGroupKeyStore.getState().getKey('g1')).toBeUndefined();
    expect(r.joinedGroups).not.toContain('g1');
    expect(r.conflictedGroups).toEqual(['g1']);
    const avisos = conflictosDe('g1');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ groupName: 'Viaje' });
    expect([...avisos[0]!.senderIds].sort()).toEqual([BETO.id, MALLORY.id].sort());
  });

  it('criterio 1 (sin elegir) · dos lotes: la primera clave queda y la segunda distinta levanta el conflicto', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    await malloryPlanta();
    const r1 = await anaDrena(deAna, cursor);
    expect(r1.joinedGroups).toEqual(['g1']); // un solo remitente: camino feliz

    await betoEntrega();
    const r2 = await anaDrena(deAna, r1.cursor);

    expect(useGroupKeyStore.getState().getKey('g1')).toEqual({ groupId: 'g1', key: FALSA, epoch: 1e9 });
    expect(r2.joinedGroups).not.toContain('g1');
    expect(r2.conflictedGroups).toEqual(['g1']);
    expect(conflictosDe('g1')).toHaveLength(1);
  });

  it('criterio 3/6 · los reenvíos de cada arranque no crean ofertas ni avisos nuevos', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    await malloryPlanta();
    const r1 = await anaDrena(deAna, cursor);
    await betoEntrega();
    const r2 = await anaDrena(deAna, r1.cursor);

    await malloryPlanta();
    await betoEntrega();
    const r3 = await anaDrena(deAna, r2.cursor);

    expect(r3.conflictedGroups).toEqual([]);
    expect(ofertasDe('g1')).toHaveLength(2);
    expect(conflictosDe('g1')).toHaveLength(1);
  });

  it('criterio 3 · la misma clave del mismo remitente N veces en un lote deja UNA oferta y adopta', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    usar(BETO);
    const clave = useGroupKeyStore.getState().ensureKey('g1').key;
    for (let i = 0; i < 3; i++) await sendGroupKey(ANA.id, { id: 'g1', name: 'Viaje' }, 'dev-beto');

    const r = await anaDrena(deAna, cursor);

    expect(r.joinedGroups).toEqual(['g1']);
    expect(ofertasDe('g1')).toHaveLength(1);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(clave);
    expect(conflictosDe('g1')).toHaveLength(0);
  });

  it('criterio 3 · dos remitentes con la MISMA clave adoptan sin aviso', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    const clave = await betoEntrega();
    usar(MALLORY);
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: clave, epoch: 1 }] });
    await sendGroupKey(ANA.id, { id: 'g1', name: 'Viaje' }, 'dev-mallory');

    const r = await anaDrena(deAna, cursor);

    expect(r.joinedGroups).toEqual(['g1']);
    expect(r.conflictedGroups).toEqual([]);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(clave);
    expect(conflictosDe('g1')).toHaveLength(0);
  });

  it('criterio 4 · S3-A1: con una clave local que NO vino de contacto, otra clave no deja oferta ni aviso', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    usar(ANA);
    const propia = useGroupKeyStore.getState().ensureKey('g1');
    await betoEntrega();

    const r = await anaDrena(deAna, cursor);

    expect(useGroupKeyStore.getState().getKey('g1')).toEqual(propia);
    expect(r.conflictedGroups).toEqual([]);
    expect(ofertasDe('g1')).toEqual([]);
    expect(conflictosDe('g1')).toHaveLength(0);
  });

  const GRUPO_FALSO = {
    id: 'g1', name: 'Viaje', memberIds: [ANA.id, MALLORY.id], currency: 'ARS',
    createdAt: 0, createdById: MALLORY.id, deletionVotes: [], updatedAt: 1, isDeleted: false,
  } as never;
  const GASTO_FALSO = {
    id: 'e-falso', groupId: 'g1', description: 'cargado sobre la clave falsa', amount: 1, currency: 'ARS',
    paidById: ANA.id, splitMode: 'equal', splits: [], category: 'other', date: 0,
    createdAt: 0, createdById: ANA.id, deletionVotes: [], updatedAt: 1, isDeleted: false,
  } as never;

  it('criterio 1 · dos lotes y elección de Beto: clave real con su época, nada del grupo falso, pendiente de drenaje', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    await malloryPlanta();
    const r1 = await anaDrena(deAna, cursor);
    expect(r1.joinedGroups).toEqual(['g1']);

    // Ana drenó el topic de K' (el grupo falso de Mallory) y cargó algo encima.
    useGroupStore.setState({ groups: [GRUPO_FALSO] });
    useExpenseStore.setState({ expenses: [GASTO_FALSO] });

    const real = await betoEntrega();
    const r2 = await anaDrena(deAna, r1.cursor);

    expect(useGroupKeyStore.getState().getKey('g1')).toEqual({ groupId: 'g1', key: FALSA, epoch: 1e9 });
    expect(r2.joinedGroups).not.toContain('g1');
    const avisos = conflictosDe('g1');
    expect(avisos).toHaveLength(1);
    expect([...avisos[0]!.senderIds].sort()).toEqual([BETO.id, MALLORY.id].sort());

    expect(await elegirClaveDeGrupo('g1', BETO.id)).toBe(true);

    expect(useGroupKeyStore.getState().getKey('g1')).toEqual({ groupId: 'g1', key: real, epoch: 1 });
    expect(useGroupStore.getState().groups.filter(g => g.id === 'g1')).toEqual([]);
    expect(useExpenseStore.getState().expenses.filter(e => e.groupId === 'g1')).toEqual([]);
    expect(estaPendienteDeDrenaje('g1')).toBe(true);
    expect(relayEngineMock.drainNow).toHaveBeenCalledWith('g1');
  });

  it('criterio 2 · mismo lote y elección: se adopta la clave de Beto', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    await malloryPlanta();
    const real = await betoEntrega();
    await anaDrena(deAna, cursor);

    expect(await elegirClaveDeGrupo('g1', BETO.id)).toBe(true);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(real);
  });

  it('criterio 4 · un remitente sin oferta no se puede elegir', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    await malloryPlanta();
    const r1 = await anaDrena(deAna, cursor);
    await betoEntrega();
    await anaDrena(deAna, r1.cursor);

    expect(await elegirClaveDeGrupo('g1', 'u-nadie')).toBe(false);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(FALSA);
  });
});

/**
 * T-136 · fix round 1 (Sybil vía el tope). Con `MAX_OFERTAS_POR_GRUPO = 5`
 * como tope de REMITENTES, un atacante que conoce el secreto de contacto de
 * la víctima podía pinnear 5 peers falsos (tarjetas auto-descriptas) y
 * llenarle el tope del grupo con la MISMA clave falsa antes de que el
 * miembro real entregara la suya: la oferta real quedaba afuera en
 * silencio — ni oferta, ni conflicto, ni aviso — y la falsa se adoptaba
 * como si fuera unánime. El tope pasa a ser de CLAVES DISTINTAS, no de
 * remitentes, así que 5 remitentes con la misma clave no le quitan lugar
 * a un sexto con una clave distinta.
 */
describe('T-136 · Sybil: el tope de remitentes ya no tapa al miembro real', () => {
  const FAKES = ['1', '2', '3', '4', '5'].map(n => usuario(`u-fake-${n}`, `Fake ${n}`));
  const FALSA = 'ef'.repeat(32);

  beforeEach(() => {
    createSecureStorage('notices').clearAll();
    useNoticeInboxStore.setState({ items: [] });
  });

  /** Beto y los 5 falsos escanearon el QR de Ana (o ella el de ellos). */
  async function anaTieneContactos(): Promise<{ deAna: string; cursor: number }> {
    usar(ANA);
    const deAna = ensureContactSecret()!;
    const tarjeta = myContactCard()!;
    for (const quien of [BETO, ...FAKES]) {
      usar(quien);
      savePeer(ANA.id, {
        secret: deAna,
        wrapPublicKey: tarjeta.wrapPublicKey,
        identityPublicKey: tarjeta.identityPublicKey,
      });
      await announceContact(deAna, `dev-${quien.id}`);
    }
    usar(ANA);
    const r = await drainContacts(deAna, 'dev-ana', 0);
    return { deAna, cursor: r.cursor };
  }

  /** Los 5 falsos plantan la MISMA clave inventada — es lo que llenaba el tope viejo. */
  async function falsosPlantan(): Promise<void> {
    for (const fake of FAKES) {
      usar(fake);
      useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: FALSA, epoch: 1 }] });
      await sendGroupKey(ANA.id, { id: 'g1', name: 'Viaje' }, `dev-${fake.id}`);
    }
  }

  async function betoEntrega(): Promise<void> {
    usar(BETO);
    useGroupKeyStore.getState().ensureKey('g1');
    await sendGroupKey(ANA.id, { id: 'g1', name: 'Viaje' }, 'dev-beto');
  }

  async function anaDrena(deAna: string, desde: number) {
    usar(ANA);
    const r = await drainContacts(deAna, 'dev-ana', desde);
    await avisarConflictosDelDrenaje(r);
    return r;
  }

  const conflictosDe = (groupId: string): KeyConflictNotice[] => useNoticeInboxStore.getState().items
    .map(i => i.notice)
    .filter((n): n is KeyConflictNotice => n.kind === 'group_key_conflict' && n.groupId === groupId);

  it('mismo lote: 5 falsos con la misma clave + Beto real → NO se adopta la falsa, hay conflicto', async () => {
    const { deAna, cursor } = await anaTieneContactos();
    await falsosPlantan();
    await betoEntrega();

    const r = await anaDrena(deAna, cursor);

    expect(useGroupKeyStore.getState().getKey('g1')).toBeUndefined();
    expect(r.joinedGroups).not.toContain('g1');
    expect(r.conflictedGroups).toEqual(['g1']);
    const avisos = conflictosDe('g1');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.senderIds).toEqual(expect.arrayContaining([BETO.id]));
  });

  it('dos lotes: la falsa (5 remitentes) queda local, y el lote de Beto NO se pierde por el tope', async () => {
    const { deAna, cursor } = await anaTieneContactos();
    await falsosPlantan();
    const r1 = await anaDrena(deAna, cursor);
    expect(r1.joinedGroups).toEqual(['g1']);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(FALSA);

    await betoEntrega();
    const r2 = await anaDrena(deAna, r1.cursor);

    // La clave local sigue siendo la falsa: no se sustituye sola.
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(FALSA);
    // Pero el grupo queda en conflicto — la oferta de Beto (el 6to remitente)
    // no se pierde por el tope. Ésta es la falla de fondo: antes, con el tope
    // viejo de 5 REMITENTES ya lleno de falsos, `registrarOferta` para Beto
    // devolvía `false` sin dejar rastro y este `r2.conflictedGroups` daba `[]`.
    expect(r2.conflictedGroups).toEqual(['g1']);
    const avisos = conflictosDe('g1');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.senderIds).toEqual(expect.arrayContaining([BETO.id]));
  });
});
