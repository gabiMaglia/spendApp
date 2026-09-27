import { publishClaim, processInvite, activeInvites, JOIN_STALL_NOTICE_AFTER_MS } from '../inviteEngine';
import {
  createInvite, deriveInviteTopic, sealGrant, sealClaim, wrapGroupKey,
  generateIdentity, generateWrapKeypair, type GroupInvite, type InviteClaim,
} from '../groupInvite';
import { drainGroup } from '../relaySync';
import {
  ensureIdentity, ensureWrapKeypair, saveInvite, listPendingJoins,
} from '@/src/store/identityStore';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore, type GroupKeyRecord } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, User } from '@/src/types/models';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import {
  conflictoForzado, idDeOfertaDeInvitacion, marcarAdoptada, marcarConflictoForzado,
  ofertasDe, registrarOferta,
} from '../groupKeyOffers';
import { savePeer } from '../contactChannel';
import { listErrors, clearErrors } from '@/src/services/errorLog';
import { MAX_MIEMBROS } from '../topes';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => {},
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  scheduleNotificationAsync: async () => 'id',
}));

/**
 * El flujo de ingreso completo, con los DOS dispositivos.
 *
 * Un solo proceso de Jest no puede tener dos storages a la vez, así que se
 * alternan: cada `usar(dispositivo)` guarda lo del anterior y restaura lo del
 * otro. Es lo que permite verificar lo único que importa acá — que el invitado
 * termina con **exactamente la misma clave** que tiene el que invitó, sin que
 * esa clave pase nunca en claro por el relay.
 */

// Relay de mentira: buzones en memoria, con la misma semántica de `seq` y de
// exclusión del propio remitente que la tabla real.
jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; created_at: string }[]>();
  let seq = 0;
  const estado = { sinRed: false };

  return {
    __buzones: buzones,
    __estado: estado,
    __reset: () => { buzones.clear(); seq = 0; estado.sinRed = false; },
    MAX_PAYLOAD_BYTES: 1_048_576,
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string) => {
      if (estado.sinRed) return { ok: false, reason: 'network' };
      const lista = buzones.get(topic) ?? [];
      lista.push({ seq: ++seq, topic, payload, sender, created_at: '' });
      buzones.set(topic, lista);
      return { ok: true, seq };
    },
    fetchSince: async (topic: string, since: number, exclude?: string, limit = 200) => {
      const todos = (buzones.get(topic) ?? [])
        .filter(e => e.seq > since && (!exclude || e.sender !== exclude))
        .slice(0, limit);
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
  __estado: { sinRed: boolean };
  __reset: () => void;
};

const ANA    = usuario('u-ana-1', 'Ana');
const BETO   = usuario('u-beto-2', 'Beto');
const MALLORY = usuario('u-mallory-3', 'Mallory');

function usuario(id: string, name: string): User {
  return {
    id, name, email: `${id}@test.com`, authProvider: 'google',
    createdAt: 0, updatedAt: 0, isDeleted: false,
  };
}

function grupo(memberIds: string[]): Group {
  return {
    id: 'g1', name: 'Viaje', memberIds, currency: 'ARS',
    // T-182: `miembros` es la fuente de verdad de `memberIds` (derivado) —
    // sin esto, `conAlta` (que admit() usa para sumar al invitado) no ve a
    // los miembros ya existentes y los pierde del roster.
    miembros: Object.fromEntries(memberIds.map((uid, i) => [uid, { estado: 'in' as const, at: i }])),
    createdAt: 0, createdById: ANA.id, deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Group;
}

// --- alternancia de dispositivos ---------------------------------------------

// T-098 scoped storage: invites/pending_joins are stored under scoped keys like invites_v1::u:u-ana
// while identity/wrapkeys/device_id are per-device (unscoped)
const CLAVES_APARATO = ['identity_v1', 'wrapkeys_v1', 'device_id'];   // dispositivo, sin scope
const CLAVES_CUENTA   = ['invites_v1', 'pending_joins_v1'];            // por cuenta, con scope (T-098 · SEC L-4)

type Estado = {
  storage: Record<string, string | undefined>;
  groups: Group[];
  users: User[];
  keys: GroupKeyRecord[];
  me: User;
};

const guardados = new Map<string, Estado>();
let actual: string | null = null;

function capturar(): Estado | null {
  if (!actual) return null;
  const storage = createSecureStorage('groupkeys');
  const uid = useAuthStore.getState().currentUser!.id;
  return {
    storage: Object.fromEntries([
      ...CLAVES_APARATO.map(k => [k, storage.getString(k)]),
      ...CLAVES_CUENTA.map(k => [k, storage.getString(`${k}::u:${uid}`)]),
    ]),
    groups: useGroupStore.getState().groups,
    users:  useUserStore.getState().users,
    keys:   useGroupKeyStore.getState().keys,
    me:     useAuthStore.getState().currentUser!,
  };
}

/** Cambia de dispositivo. El primero de cada id arranca en blanco. */
function usar(id: string, me: User): void {
  const anterior = capturar();
  if (anterior && actual) guardados.set(actual, anterior);

  const storage = createSecureStorage('groupkeys');
  storage.clearAll();

  const estado = guardados.get(id);
  if (estado) {
    // Restore unscoped device keys
    for (const k of CLAVES_APARATO) {
      const v = estado.storage[k];
      if (v !== undefined) storage.set(k, v);
    }
    // Restore scoped account keys with the NEW user's ID (not the old one)
    for (const k of CLAVES_CUENTA) {
      const v = estado.storage[k];
      if (v !== undefined) storage.set(`${k}::u:${me.id}`, v);
    }
    useGroupStore.setState({ groups: estado.groups });
    useUserStore.setState({ users: estado.users });
    useGroupKeyStore.setState({ keys: estado.keys });
  } else {
    useGroupStore.setState({ groups: [] });
    useUserStore.setState({ users: [] });
    useGroupKeyStore.setState({ keys: [] });
  }

  useAuthStore.setState({ currentUser: me });
  actual = id;
}

/** Escenario base: Ana con el grupo y su clave, y una invitación emitida. */
function anaInvita(): { invite: GroupInvite; clave: string; identidadDeAna: string } {
  usar('ana', ANA);
  useGroupStore.setState({ groups: [grupo([ANA.id])] });
  useUserStore.setState({ users: [ANA] });

  const record = useGroupKeyStore.getState().ensureKey('g1');
  const identidadDeAna = ensureIdentity().publicKey;
  const invite = createInvite('g1', 'Viaje', identidadDeAna);
  saveInvite(invite);

  return { invite, clave: record.key, identidadDeAna };
}

/** Como `anaInvita`, pero Beto ya es miembro del grupo (SEC-06, T-151). */
function anaInvitaConBeto(): { invite: GroupInvite; clave: string; identidadDeAna: string } {
  usar('ana', ANA);
  useGroupStore.setState({ groups: [grupo([ANA.id, BETO.id])] });
  useUserStore.setState({ users: [ANA, BETO] });

  const record = useGroupKeyStore.getState().ensureKey('g1');
  const identidadDeAna = ensureIdentity().publicKey;
  const invite = createInvite('g1', 'Viaje', identidadDeAna);
  saveInvite(invite);

  return { invite, clave: record.key, identidadDeAna };
}

/** Deja un sobre en el buzón de la invitación como si lo mandara otro. */
async function inyectar(invite: GroupInvite, payload: string, sender: string): Promise<void> {
  const topic = await deriveInviteTopic(invite.token);
  const lista = relayMock.__buzones.get(topic) ?? [];
  lista.push({ seq: 9_000 + lista.length, payload, sender });
  relayMock.__buzones.set(topic, lista);
}

beforeEach(() => {
  relayMock.__reset();
  guardados.clear();
  actual = null;
  for (const id of ['groups', 'users', 'groupkeys'] as const) createSecureStorage(id).clearAll();
  clearErrors();
});

// -----------------------------------------------------------------------------

describe('ingreso a un grupo por link, de punta a punta', () => {
  it('el invitado termina con la MISMA clave que el que invitó', async () => {
    const { invite, clave } = anaInvita();

    usar('beto', BETO);
    expect(await publishClaim(invite, 'dev-beto')).toBe(true);

    usar('ana', ANA);
    await processInvite(invite, 'dev-ana');

    usar('beto', BETO);
    const adoptados = await processInvite(invite, 'dev-beto');

    expect(adoptados).toEqual(['g1']);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(clave);
  });

  it('el que invita suma al invitado al grupo y a sus contactos', async () => {
    const { invite } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');

    usar('ana', ANA);
    await processInvite(invite, 'dev-ana');

    expect(useGroupStore.getState().getById('g1')!.memberIds).toContain(BETO.id);
    expect(useUserStore.getState().getUserById(BETO.id)?.name).toBe('Beto');
  });

  // Si la clave llegara primero, el invitado abriría un buzón de grupo todavía
  // vacío, se quedaría sin el grupo y nada volvería a dispararlo.
  it('el estado del grupo se publica ANTES de entregar la clave', async () => {
    const { invite, clave } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');

    usar('ana', ANA);
    await processInvite(invite, 'dev-ana');

    const topicInvitacion = await deriveInviteTopic(invite.token);
    const entrega = relayMock.__buzones.get(topicInvitacion)!.find(e => e.sender === 'dev-ana')!;

    // El buzón del grupo es el otro que se escribió: su sobre tiene que ser anterior.
    const delGrupo = [...relayMock.__buzones.entries()]
      .filter(([topic]) => topic !== topicInvitacion)
      .flatMap(([, sobres]) => sobres);

    expect(delGrupo.length).toBeGreaterThan(0);
    expect(Math.min(...delGrupo.map(e => e.seq))).toBeLessThan(entrega.seq);
    expect(clave).toBeTruthy();
  });

  it('el invitado ve el grupo después de drenar', async () => {
    const { invite } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');
    usar('ana', ANA);
    await processInvite(invite, 'dev-ana');
    usar('beto', BETO);
    await processInvite(invite, 'dev-beto');

    await drainGroup('g1', BETO.id, 'dev-beto', 0);

    const g = useGroupStore.getState().getById('g1');
    expect(g?.name).toBe('Viaje');
    expect(g?.memberIds).toContain(BETO.id);
  });

  it('procesar dos veces no duplica al miembro ni rompe nada', async () => {
    const { invite } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');

    usar('ana', ANA);
    await processInvite(invite, 'dev-ana');
    await processInvite(invite, 'dev-ana');

    const miembros = useGroupStore.getState().getById('g1')!.memberIds;
    expect(miembros.filter(m => m === BETO.id)).toHaveLength(1);
  });

  it('el ingreso queda pendiente hasta que llega la clave, y después se cierra', async () => {
    const { invite } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');
    expect(listPendingJoins()).toHaveLength(1); // el otro todavía no contestó

    usar('ana', ANA);
    await processInvite(invite, 'dev-ana');

    usar('beto', BETO);
    await processInvite(invite, 'dev-beto');
    expect(listPendingJoins()).toHaveLength(0);
  });
});

describe('lo que el buzón de invitación NO permite', () => {
  // La huella viajó en el link, por un canal que el relay no controla. Sin la
  // privada que le corresponde no se puede fabricar una entrega válida.
  it('un tercero con el link no puede hacerse pasar por quien invitó', async () => {
    const { invite } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');

    // Mallory tiene el link (y por lo tanto el token), pero no la clave del
    // grupo ni la identidad de Ana: manda una clave inventada.
    const mallory = generateIdentity();
    const wrapM = generateWrapKeypair();
    const publicaDeBeto = ensureWrapKeypair().publicKey;

    const falsa = await sealGrant(invite.token, {
      groupId: 'g1',
      forUserId: BETO.id,
      wrappedKey: wrapGroupKey('ff'.repeat(32), publicaDeBeto, wrapM.privateKey),
      senderWrapPublicKey: wrapM.publicKey,
      grantedByIdentity: mallory.publicKey,
      epoch: 1,
      grantedAt: Date.now(),
    }, mallory.privateKey);

    await inyectar(invite, falsa, 'dev-mallory');
    const adoptados = await processInvite(invite, 'dev-beto');

    expect(adoptados).toEqual([]);
    expect(useGroupKeyStore.getState().getKey('g1')).toBeUndefined();
  });

  // La huella sola no alcanza: es pública y va en el link. Quien además conoce
  // la pública entera de quien invita (un miembro viejo del grupo, por ejemplo)
  // podría copiarla y hacerse pasar por él. Lo que no puede es firmar por él.
  it('copiar la identidad de quien invita no sirve sin su clave privada', async () => {
    const { invite, identidadDeAna } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');

    const mallory = generateIdentity();
    const wrapM = generateWrapKeypair();

    const falsa = await sealGrant(invite.token, {
      groupId: 'g1',
      forUserId: BETO.id,
      wrappedKey: wrapGroupKey('ff'.repeat(32), ensureWrapKeypair().publicKey, wrapM.privateKey),
      senderWrapPublicKey: wrapM.publicKey,
      grantedByIdentity: identidadDeAna, // se hace pasar por Ana…
      epoch: 1,
      grantedAt: Date.now(),
    }, mallory.privateKey);      // …pero firma con SU privada

    await inyectar(invite, falsa, 'dev-mallory');

    expect(await processInvite(invite, 'dev-beto')).toEqual([]);
    expect(useGroupKeyStore.getState().getKey('g1')).toBeUndefined();
  });

  // Una clave del largo equivocado dejaría el grupo ilegible para siempre, sin
  // más síntoma que "no llega nada". Se rechaza aunque la entrega sea legítima.
  it('una clave con formato inválido no se adopta', async () => {
    const { invite, identidadDeAna } = anaInvita();
    const identidadPrivadaDeAna = ensureIdentity().privateKey;
    const wrapDeAna = ensureWrapKeypair();

    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');

    const rota = await sealGrant(invite.token, {
      groupId: 'g1',
      forUserId: BETO.id,
      wrappedKey: wrapGroupKey('no-es-una-clave', ensureWrapKeypair().publicKey, wrapDeAna.privateKey),
      senderWrapPublicKey: wrapDeAna.publicKey,
      grantedByIdentity: identidadDeAna,
      epoch: 1,
      grantedAt: Date.now(),
    }, identidadPrivadaDeAna);

    await inyectar(invite, rota, 'dev-ana');

    expect(await processInvite(invite, 'dev-beto')).toEqual([]);
    expect(useGroupKeyStore.getState().getKey('g1')).toBeUndefined();
  });

  // Irse del grupo tiene que sacarte también la capacidad de dejar entrar gente:
  // la clave te queda en el teléfono, pero ya no sos parte.
  it('quien se fue del grupo no puede seguir admitiendo', async () => {
    const { invite } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');

    usar('ana', ANA);
    useGroupStore.setState({ groups: [grupo([])] }); // Ana ya no es miembro
    await processInvite(invite, 'dev-ana');

    const topic = await deriveInviteTopic(invite.token);
    const sobres = relayMock.__buzones.get(topic) ?? [];
    expect(sobres.filter(e => e.sender === 'dev-ana')).toHaveLength(0);
  });

  it('una invitación vencida no publica reclamo ni se procesa', async () => {
    const { invite } = anaInvita();
    const vencida = { ...invite, expiresAt: Date.now() - 1 };

    usar('beto', BETO);
    expect(await publishClaim(vencida, 'dev-beto')).toBe(false);
    expect(await processInvite(vencida, 'dev-beto')).toEqual([]);
  });

  // Sin esto, quedarse sin señal justo al aceptar dejaría el ingreso perdido:
  // no hay reclamo publicado NI nada anotado que lo reintente.
  it('si el envío falla, el ingreso queda igual pendiente de reintento', async () => {
    const { invite } = anaInvita();

    usar('beto', BETO);
    relayMock.__estado.sinRed = true;

    expect(await publishClaim(invite, 'dev-beto')).toBe(false);
    expect(listPendingJoins().map(i => i.token)).toEqual([invite.token]);
  });

  it('sin sesión no se publica nada', async () => {
    const { invite } = anaInvita();

    usar('beto', BETO);
    useAuthStore.setState({ currentUser: null });

    expect(await publishClaim(invite, 'dev-beto')).toBe(false);
  });

  // Quien no tiene la clave del grupo no puede admitir a nadie: es lo que evita
  // que un invitado recién entrado reparta accesos a un grupo que no es suyo.
  it('quien no tiene la clave del grupo no entrega nada', async () => {
    const { invite } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');

    // Carla ve el buzón (tiene el link) pero no la clave ni el grupo.
    usar('carla', usuario('u-carla', 'Carla'));
    await processInvite(invite, 'dev-carla');

    const topic = await deriveInviteTopic(invite.token);
    const sobres = relayMock.__buzones.get(topic) ?? [];
    expect(sobres.filter(e => e.sender === 'dev-carla')).toHaveLength(0);
  });
});

// T-150 ronda 2 (D4, verifier): `admit()` es un camino sin UI (lo corre quien
// invita, del lado del que ya está en el grupo) — un grupo nunca debe superar
// MAX_MIEMBROS por acá tampoco, y el rechazo deja rastro en el diagnóstico
// porque no hay ninguna pantalla del lado de quien admite para avisarle.
describe('T-150 ronda 2 (D4): tope de miembros al admitir un reclamo', () => {
  it('un grupo ya en el tope rechaza al nuevo reclamante, con rastro en el diagnóstico', async () => {
    usar('ana', ANA);
    const llenoConAna = [ANA.id, ...Array.from({ length: MAX_MIEMBROS - 1 }, (_, i) => `relleno-${i}`)];
    useGroupStore.setState({ groups: [grupo(llenoConAna)] });
    useUserStore.setState({ users: [ANA] });
    const record = useGroupKeyStore.getState().ensureKey('g1');
    const identidadDeAna = ensureIdentity().publicKey;
    const invite = createInvite('g1', 'Viaje', identidadDeAna);
    saveInvite(invite);

    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');

    usar('ana', ANA);
    await processInvite(invite, 'dev-ana');

    expect(useGroupStore.getState().getById('g1')!.memberIds).not.toContain(BETO.id);
    expect(useGroupKeyStore.getState().getKey('g1')).toEqual(record);
    expect(listErrors().some(e => e.message.includes('tope_de_miembros'))).toBe(true);
  });

  /**
   * Ruling del orquestador (handoff ronda 2/5, punto 3): el rastro de
   * diagnóstico no lo ve nadie — quien invita necesita un aviso VISIBLE. Se
   * anota en la bandeja de avisos de quien admite (ANA, dueña de la
   * invitación), una sola vez por invitación aunque `processInvite` reintente
   * el mismo reclamo en cada sync (T-096: sin cursor, el buzón se relee
   * entero mientras siga vivo).
   */
  it('avisa a quien invita, en la bandeja de avisos, que alguien intentó entrar a un grupo lleno', async () => {
    usar('ana', ANA);
    const llenoConAna = [ANA.id, ...Array.from({ length: MAX_MIEMBROS - 1 }, (_, i) => `relleno-${i}`)];
    useGroupStore.setState({ groups: [grupo(llenoConAna)] });
    useUserStore.setState({ users: [ANA] });
    useGroupKeyStore.getState().ensureKey('g1');
    const identidadDeAna = ensureIdentity().publicKey;
    const invite = createInvite('g1', 'Viaje', identidadDeAna);
    saveInvite(invite);
    createSecureStorage('notices').clearAll();
    useNoticeInboxStore.setState({ items: [] });

    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');

    usar('ana', ANA);
    await processInvite(invite, 'dev-ana');

    const avisos = useNoticeInboxStore.getState().items.filter(i => i.notice.kind === 'group_invite_full');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.notice).toMatchObject({ kind: 'group_invite_full', groupId: 'g1' });
  });

  it('no apila un aviso por cada reintento del mismo reclamo', async () => {
    usar('ana', ANA);
    const llenoConAna = [ANA.id, ...Array.from({ length: MAX_MIEMBROS - 1 }, (_, i) => `relleno-${i}`)];
    useGroupStore.setState({ groups: [grupo(llenoConAna)] });
    useUserStore.setState({ users: [ANA] });
    useGroupKeyStore.getState().ensureKey('g1');
    const identidadDeAna = ensureIdentity().publicKey;
    const invite = createInvite('g1', 'Viaje', identidadDeAna);
    saveInvite(invite);
    createSecureStorage('notices').clearAll();
    useNoticeInboxStore.setState({ items: [] });

    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');

    usar('ana', ANA);
    await processInvite(invite, 'dev-ana');
    await processInvite(invite, 'dev-ana'); // reintento del mismo reclamo, mismo sync

    const avisos = useNoticeInboxStore.getState().items.filter(i => i.notice.kind === 'group_invite_full');
    expect(avisos).toHaveLength(1);
  });
});

describe('activeInvites', () => {
  it('junta las emitidas y las aceptadas, sin repetir', async () => {
    const { invite } = anaInvita();
    saveInvite(invite);

    expect(activeInvites().map(i => i.token)).toEqual([invite.token]);
  });
});

/**
 * T-136 criterio 5. Antes, `redeem` veía «ya tengo clave» y cerraba el ingreso
 * en silencio: una clave plantada por contacto también bloqueaba el link.
 */
const FALSA = 'ab'.repeat(32);

/** Ana invitó y ya entregó el grant; Beto todavía no procesó su buzón. */
async function grantEsperandoABeto(): Promise<{ invite: GroupInvite; clave: string }> {
  const { invite, clave } = anaInvita();
  usar('beto', BETO);
  await publishClaim(invite, 'dev-beto');
  usar('ana', ANA);
  await processInvite(invite, 'dev-ana');
  usar('beto', BETO);
  createSecureStorage('notices').clearAll();
  useNoticeInboxStore.setState({ items: [] });
  return { invite, clave };
}

describe('T-136 · la invitación choca con una clave plantada por contacto', () => {
  /** Lo que habría dejado `drainContacts`: la clave de Mallory, adoptada por contacto. */
  function plantadaPorContacto(key: string): void {
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key, epoch: 1e9 }] });
    registrarOferta({
      groupId: 'g1', fromUserId: 'u-mallory-3', key, epoch: 1e9,
      origen: 'contact', receivedAt: 0, adoptada: false,
    });
    marcarAdoptada('g1', 'u-mallory-3');
  }

  const avisos = () => useNoticeInboxStore.getState().items.filter(i => i.notice.kind === 'group_key_conflict');

  it('con OTRA clave: registra la oferta de la invitación, avisa y no sustituye', async () => {
    const { invite, clave } = await grantEsperandoABeto();
    plantadaPorContacto(FALSA);

    expect(await processInvite(invite, 'dev-beto')).toEqual([]);

    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(FALSA);
    expect(ofertasDe('g1').find(o => o.origen === 'invite')).toMatchObject({
      key: clave, fromUserId: idDeOfertaDeInvitacion(invite.inviterFingerprint), adoptada: false,
    });
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0]!.notice).toMatchObject({ groupName: 'Viaje' });
    expect(listPendingJoins()).toHaveLength(0);
  });

  it('reprocesar el mismo buzón no apila ofertas ni avisos', async () => {
    const { invite } = await grantEsperandoABeto();
    plantadaPorContacto(FALSA);

    await processInvite(invite, 'dev-beto');
    await processInvite(invite, 'dev-beto');

    expect(ofertasDe('g1').filter(o => o.origen === 'invite')).toHaveLength(1);
    expect(avisos()).toHaveLength(1);
  });

  it('con la MISMA clave: se cierra como siempre, sin oferta ni aviso', async () => {
    const { invite, clave } = await grantEsperandoABeto();
    plantadaPorContacto(clave);

    expect(await processInvite(invite, 'dev-beto')).toEqual([]);

    expect(ofertasDe('g1').filter(o => o.origen === 'invite')).toEqual([]);
    expect(avisos()).toHaveLength(0);
    expect(listPendingJoins()).toHaveLength(0);
  });

  it('S3-A1 · clave local que NO vino de contacto: se cierra como siempre, sin oferta ni aviso', async () => {
    const { invite } = await grantEsperandoABeto();
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: FALSA, epoch: 1 }] });

    expect(await processInvite(invite, 'dev-beto')).toEqual([]);

    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(FALSA);
    expect(ofertasDe('g1')).toEqual([]);
    expect(avisos()).toHaveLength(0);
    expect(listPendingJoins()).toHaveLength(0);
  });
});

/**
 * T-136 · D-3 (revisión final). El grupo nunca tuvo clave local y un atacante
 * lo dejó en conflicto FORZADO (claves Sybil que no entraron por el tope). Si
 * la invitación legítima adopta la clave real sin limpiar nada, el grupo queda
 * bien pero la tarjeta de conflicto sigue ofreciendo como única salida borrarlo
 * — el usuario destruiría un grupo ya resuelto.
 */
describe('T-136 · la invitación resuelve un grupo en conflicto forzado sin clave local', () => {
  it('adopta la clave y deja el grupo sin conflicto forzado ni ofertas pendientes', async () => {
    const { invite, clave } = await grantEsperandoABeto();

    // El ataque: varias claves de contacto distintas, la última fuera de tabla.
    for (let i = 0; i < 3; i++) {
      registrarOferta({
        groupId: 'g1', fromUserId: `u-sybil-${i}`, key: `0${i}`.repeat(32),
        epoch: 1, origen: 'contact', receivedAt: 0, adoptada: false,
      });
    }
    marcarConflictoForzado('g1');

    expect(conflictoForzado('g1')).toBe(true);
    expect(useGroupKeyStore.getState().getKey('g1')).toBeUndefined();

    expect(await processInvite(invite, 'dev-beto')).toEqual(['g1']);

    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(clave);
    expect(conflictoForzado('g1')).toBe(false);
    expect(ofertasDe('g1')).toEqual([]);
  });
});

describe('T-096 · invitación de un solo uso (claimedBy)', () => {
  it('un segundo reclamante distinto no se admite tras el primero (T-096, un solo uso)', async () => {
    relayMock.__reset();
    const { invite } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'device-beto');

    usar('mallory', MALLORY);
    await publishClaim(invite, 'device-mallory');

    usar('ana', ANA);
    await processInvite(invite, 'device-ana');

    // El mismo lote ya tiene los dos reclamos (Beto y Mallory publicaron antes de
    // que Ana procesara): sólo Beto debe quedar admitido.
    expect(useGroupStore.getState().getById('g1')!.memberIds).toContain(BETO.id);
    expect(useGroupStore.getState().getById('g1')!.memberIds).not.toContain(MALLORY.id);

    usar('mallory', MALLORY);
    const adoptadosMallory = await processInvite(invite, 'device-mallory');
    expect(adoptadosMallory).toEqual([]);
  });

  it('el mismo reclamante puede reintentar después de haber sido admitido', async () => {
    relayMock.__reset();
    const { invite } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'device-beto');

    usar('ana', ANA);
    await processInvite(invite, 'device-ana');

    usar('beto', BETO);
    const adoptados = await processInvite(invite, 'device-beto');
    // Beto ya fue admitido y recibe la llave.
    expect(adoptados).toEqual(['g1']);
  });

  it('la vulnerabilidad cross-device NO es reachable: activeInvites vacio tras redeem (T-096)', async () => {
    // Verifica que el escenario criticado por el reviewer (otro dispositivo reabre
    // el invite tras que alguien se une) NO es reachable en el flujo normal,
    // porque removePendingJoin() limpia el invite de la lista de activeInvites().
    relayMock.__reset();
    const { invite } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'device-beto');
    // Beto tiene el invite pendiente
    expect(listPendingJoins().map(i => i.token)).toContain(invite.token);

    usar('ana', ANA);
    await processInvite(invite, 'device-ana');

    usar('beto', BETO);
    const adoptados = await processInvite(invite, 'device-beto');
    expect(adoptados).toEqual(['g1']); // Beto recibe la llave y entra

    // GARANTIA: removePendingJoin limpió el invite de K_PENDING de Beto.
    // Beto tampoco tiene el invite en K_INVITES (nunca llamó saveInvite).
    // Por lo tanto, activeInvites() en Beto no lo incluye.
    expect(listPendingJoins().map(i => i.token)).not.toContain(invite.token);
    // Resultado: processAllInvites() nunca lo reprocessaría en Beto's device,
    // así que el riesgo de que Beto (nuevo miembro) admita a Mallory NO es reachable
    // a través del flujo normal. (Sí lo sería si algo explícitamente llamara
    // processInvite(invite), pero eso no es un code path actual.)
  });
});

describe('SEC-06 (T-151) · un reclamo a nombre de alguien que YA es miembro', () => {
  /**
   * `admit` aceptaba un reclamo cuyo `userId` YA era miembro —el
   * `if (!group.memberIds.includes(...))` se salteaba y `sendEnvelope` iba
   * igual—, así que con el link alguien entraba «como Beto» sin figurar como
   * miembro nuevo ni disparar el aviso `joined`: recibía la clave en silencio.
   */
  it('un reclamo a nombre de alguien que YA es miembro no recibe la clave', async () => {
    // Ana invita a un grupo donde Beto ya es miembro. Mallory reclama diciendo ser Beto.
    const { invite } = anaInvitaConBeto();

    usar('mallory', MALLORY);
    useAuthStore.setState({ currentUser: { ...MALLORY, id: BETO.id } });
    await publishClaim(invite, 'device-mallory');

    usar('ana', ANA);
    await processInvite(invite, 'device-ana');

    // En el buzón de invitación hay SOLO el reclamo (ningún grant de Ana): el
    // filtro es por sobres de ANA (quien admitiría), no por remitente del
    // reclamo, porque tanto el reclamo como un eventual grant indebido viajan
    // por el mismo buzón y el grant lo firma el propio dispositivo de Ana.
    const topic = await deriveInviteTopic(invite.token);
    expect(relayMock.__buzones.get(topic) ?? []).toHaveLength(1);
    expect(useGroupStore.getState().groups[0]!.memberIds).toEqual([ANA.id, BETO.id]);
  });

  it('el propio miembro reinstalado SÍ recibe la clave si su identidad Y su wrap coinciden con las pinneadas', async () => {
    const { invite } = anaInvitaConBeto();

    usar('beto', BETO);
    const identidadDeBeto = ensureIdentity().publicKey;
    const wrapDeBeto = ensureWrapKeypair().publicKey;
    await publishClaim(invite, 'device-beto');

    usar('ana', ANA);
    savePeer(BETO.id, { secret: 'sec-beto', identityPublicKey: identidadDeBeto, wrapPublicKey: wrapDeBeto });
    await processInvite(invite, 'device-ana');

    // Reclamo + entrega: los dos sobres del buzón de invitación.
    const topic = await deriveInviteTopic(invite.token);
    expect((relayMock.__buzones.get(topic) ?? []).length).toBe(2);
  });

  /**
   * D1 (verifier T-151, ronda 1): la identidad Ed25519 es pública (tarjeta de
   * contacto, `k` de cada registro firmado) y el claim no va firmado. Mallory
   * copia el `userId` y la `identityPublicKey` REALES de Beto pero pone SU
   * PROPIA wrap key — antes de este fix, `admit` sólo comparaba
   * `identityPublicKey` y esto pasaba: la clave del grupo salía envuelta hacia
   * la wrap de Mallory, que ella sí puede abrir.
   */
  it('T-151 D1: identidad pública copiada + wrap propia de Mallory no basta con Beto pinneado', async () => {
    const { invite } = anaInvitaConBeto();

    usar('beto', BETO);
    const identidadDeBeto = ensureIdentity().publicKey;
    const wrapDeBeto = ensureWrapKeypair().publicKey;

    usar('ana', ANA);
    savePeer(BETO.id, { secret: 'sec-beto', identityPublicKey: identidadDeBeto, wrapPublicKey: wrapDeBeto });

    // Mallory arma el reclamo a mano: userId + identidad pública REALES de
    // Beto (copiables, públicas), pero su PROPIA wrap key.
    const wrapDeMallory = generateWrapKeypair().publicKey;
    const claimFalso: InviteClaim = {
      kind: 'claim',
      groupId: invite.groupId,
      userId: BETO.id,
      wrapPublicKey: wrapDeMallory,
      identityPublicKey: identidadDeBeto.toUpperCase(), // mayúsculas: la comparación normaliza
      displayName: 'Beto',
      claimedAt: Date.now(),
    };
    await inyectar(invite, await sealClaim(invite.token, claimFalso), 'device-mallory');

    await processInvite(invite, 'device-ana');

    // Sólo el reclamo de Mallory en el buzón: ningún grant salió.
    const topic = await deriveInviteTopic(invite.token);
    expect(relayMock.__buzones.get(topic) ?? []).toHaveLength(1);
    expect(useGroupStore.getState().groups[0]!.memberIds).toEqual([ANA.id, BETO.id]);
  });

  /**
   * O3 (verifier T-151, ronda 2): la comparación de `wrapPublicKey` en `admit`
   * normaliza con `toLowerCase`, pero `wrapGroupKey` envolvía con el valor
   * CRUDO del claim. Si el propio Beto reclama con su wrap en mayúsculas (un
   * cliente que la formatee distinto, por ejemplo), pasaba la comparación
   * pero la clave salía envuelta hacia un `info` HKDF que no coincide con el
   * que deriva `unwrapGroupKey` desde su clave privada real (minúsculas,
   * `toHex`) — el link quedaba gastado sin que ni el dueño real pudiera abrir
   * el grant.
   */
  it('T-151 O3: Beto legítimo con su wrap en MAYÚSCULAS sí puede abrir el grant', async () => {
    const { invite } = anaInvita();

    usar('beto', BETO);
    const identidadDeBeto = ensureIdentity().publicKey;
    const wrapDeBeto = ensureWrapKeypair().publicKey;

    const claimEnMayusculas: InviteClaim = {
      kind: 'claim',
      groupId: invite.groupId,
      userId: BETO.id,
      wrapPublicKey: wrapDeBeto.toUpperCase(),
      identityPublicKey: identidadDeBeto,
      displayName: 'Beto',
      claimedAt: Date.now(),
    };
    await inyectar(invite, await sealClaim(invite.token, claimEnMayusculas), 'device-beto');

    usar('ana', ANA);
    await processInvite(invite, 'device-ana');

    usar('beto', BETO);
    const adoptados = await processInvite(invite, 'device-beto');
    expect(adoptados).toEqual(['g1']);
  });
});

/**
 * **T-172 (ítem 2, hallazgo de T-151 GAP): el reclamante rechazado reintenta
 * en silencio indefinidamente.**
 *
 * `processAllInvites` relee el buzón entero en cada sync (T-096, sin cursor)
 * mientras la invitación siga viva. Si `admit()` sigue rechazando —identidad
 * no pinneada, tope de miembros, canje de otra persona— el invitado nunca se
 * enteraba de que su ingreso no se iba a completar solo: esperaba en
 * silencio hasta que la invitación expiraba a las 48hs.
 *
 * **Ronda 2/5 (D1 del verificador): la ronda 1 contaba LLAMADAS, no tiempo.**
 * `app/groups/join.tsx` sondea cada 3s durante 25s con la pantalla abierta —
 * unas 8 llamadas en segundos, no en ciclos de sync separados. Eso disparaba
 * el aviso "no se completó" mientras el ingreso todavía podía cerrar bien
 * segundos después. Estos tests fijan tiempo con `jest.useFakeTimers`
 * (sólo `Date`, para no tocar los `setTimeout` reales que sí usa este
 * archivo en otras pruebas) y verifican que ahora manda el reloj, no el
 * contador de sondeos.
 */
describe('T-172 (ítem 2) · el reclamante se entera por TIEMPO, no por cantidad de sondeos', () => {
  // Sólo se fija `Date`: este archivo usa `setTimeout` real en otras pruebas
  // (`processAllInvites`/`withTimeout`), y fakearlo tumbaría esas.
  function fijarSoloFecha(): void {
    jest.useFakeTimers({ doNotFake: [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask',
      'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'hrtime', 'performance',
    ] });
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('el loop de join.tsx (8 sondeos cada 3s, ~21s en total) NO dispara el aviso', async () => {
    // PoC del verificador: Mallory reclama "como Beto" (SEC-06) — admit() la
    // rechaza en cada pasada porque su wrap no coincide con la pinneada, así
    // que el ingreso nunca cierra solo. Con la ronda 1 (conteo de llamadas),
    // 6-8 sondeos alcanzaban para avisar "no se completó" en segundos.
    const { invite } = anaInvitaConBeto();
    createSecureStorage('notices').clearAll();
    useNoticeInboxStore.setState({ items: [] });

    fijarSoloFecha();
    jest.setSystemTime(0);

    usar('mallory', MALLORY);
    useAuthStore.setState({ currentUser: { ...MALLORY, id: BETO.id } });
    await publishClaim(invite, 'device-mallory');

    for (let i = 1; i <= 8; i++) {
      jest.setSystemTime(i * 3_000); // REINTENTO_MS de join.tsx
      await processInvite(invite, 'device-mallory');
    }

    expect(useNoticeInboxStore.getState().items.some(i => i.notice.kind === 'join_claim_stalled')).toBe(false);
  });

  it(`tras ${JOIN_STALL_NOTICE_AFTER_MS}ms sin recibir grant, avisa UNA vez (no antes)`, async () => {
    const { invite } = anaInvitaConBeto();
    createSecureStorage('notices').clearAll();
    useNoticeInboxStore.setState({ items: [] });

    fijarSoloFecha();
    jest.setSystemTime(0);

    usar('mallory', MALLORY);
    useAuthStore.setState({ currentUser: { ...MALLORY, id: BETO.id } });
    await publishClaim(invite, 'device-mallory');

    jest.setSystemTime(JOIN_STALL_NOTICE_AFTER_MS - 1);
    await processInvite(invite, 'device-mallory');
    expect(useNoticeInboxStore.getState().items.some(i => i.notice.kind === 'join_claim_stalled')).toBe(false);

    jest.setSystemTime(JOIN_STALL_NOTICE_AFTER_MS);
    await processInvite(invite, 'device-mallory'); // umbral cumplido

    const avisos = useNoticeInboxStore.getState().items.filter(i => i.notice.kind === 'join_claim_stalled');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.notice).toMatchObject({ kind: 'join_claim_stalled', groupId: invite.groupId, inviteToken: invite.token });

    // Sondeos posteriores no apilan un segundo aviso.
    jest.setSystemTime(JOIN_STALL_NOTICE_AFTER_MS + 60_000);
    await processInvite(invite, 'device-mallory');
    expect(useNoticeInboxStore.getState().items.filter(i => i.notice.kind === 'join_claim_stalled')).toHaveLength(1);
  });

  it('si el grant llega antes de que se cumpla el umbral de tiempo, nunca avisa', async () => {
    const { invite } = anaInvita();
    createSecureStorage('notices').clearAll();
    useNoticeInboxStore.setState({ items: [] });

    usar('beto', BETO);
    await publishClaim(invite, 'device-beto');

    usar('ana', ANA);
    await processInvite(invite, 'device-ana'); // admite y entrega en la 1ra pasada

    usar('beto', BETO);
    const adoptados = await processInvite(invite, 'device-beto');
    expect(adoptados).toEqual(['g1']);

    expect(useNoticeInboxStore.getState().items.some(i => i.notice.kind === 'join_claim_stalled')).toBe(false);
  });

  it('aviso ya emitido y el ingreso se completa después → el aviso queda resuelto', async () => {
    // El invariante del ítem 2: el aviso nunca puede quedar contradiciendo un
    // ingreso exitoso. Beto se demora en publicar su reclamo (podría ser
    // porque tardó en abrir el link), el umbral se cumple sin que Ana haya
    // abierto la app todavía, y RECIÉN DESPUÉS Ana entra y admite.
    const { invite } = anaInvita();
    createSecureStorage('notices').clearAll();
    useNoticeInboxStore.setState({ items: [] });

    fijarSoloFecha();
    jest.setSystemTime(0);

    usar('beto', BETO);
    await publishClaim(invite, 'device-beto');

    jest.setSystemTime(JOIN_STALL_NOTICE_AFTER_MS);
    await processInvite(invite, 'device-beto'); // Ana todavía no procesó nada: avisa

    let avisos = useNoticeInboxStore.getState().items.filter(i => i.notice.kind === 'join_claim_stalled');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.readAt).toBeNull();

    // Ana por fin abre la app y admite.
    usar('ana', ANA);
    await processInvite(invite, 'device-ana');

    // Beto vuelve a sondear y recibe la clave.
    usar('beto', BETO);
    const adoptados = await processInvite(invite, 'device-beto');
    expect(adoptados).toEqual(['g1']);

    avisos = useNoticeInboxStore.getState().items.filter(i => i.notice.kind === 'join_claim_stalled');
    expect(avisos).toHaveLength(1); // no se borra ni se duplica: se resuelve
    expect(avisos[0]!.readAt).not.toBeNull();
  });
});

describe('D2 (verifier T-151, ronda 1) · reintento del invitado nuevo si la primera entrega falla', () => {
  /**
   * `admit` suma al invitado a `memberIds` ANTES de mandar la entrega. Si el
   * primer `sendEnvelope` falla (sin red), el invitado queda en `memberIds`
   * sin estar pinneado en ningún lado. Antes de este fix, el reintento
   * quedaba bloqueado para siempre por el chequeo de SEC-06 (D1): un invitado
   * nuevo nunca pasa por el camino de contacto que lo pinnea.
   */
  it('mismo reclamante: si la primera entrega falla por red, el reintento con la MISMA wrap sí entrega la clave', async () => {
    const { invite } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'device-beto');

    usar('ana', ANA);
    relayMock.__estado.sinRed = true;
    await processInvite(invite, 'device-ana'); // el grant no sale: sin red
    relayMock.__estado.sinRed = false;

    // Beto ya quedó sumado a memberIds aunque la entrega se perdió.
    expect(useGroupStore.getState().getById('g1')!.memberIds).toContain(BETO.id);

    await processInvite(invite, 'device-ana'); // reintento: mismo reclamo, misma wrap

    usar('beto', BETO);
    const adoptados = await processInvite(invite, 'device-beto');
    expect(adoptados).toEqual(['g1']);
  });

  it('otro con el link: mismo userId pero OTRA wrap no es el mismo reclamante y se rechaza', async () => {
    const { invite } = anaInvita();

    usar('beto', BETO);
    await publishClaim(invite, 'device-beto');

    usar('ana', ANA);
    relayMock.__estado.sinRed = true;
    await processInvite(invite, 'device-ana'); // Beto queda en memberIds, claimedWrapKey = wrap de Beto
    relayMock.__estado.sinRed = false;

    // Alguien más arma un reclamo "como Beto" con OTRA wrap.
    const claimOtraWrap: InviteClaim = {
      kind: 'claim',
      groupId: invite.groupId,
      userId: BETO.id,
      wrapPublicKey: generateWrapKeypair().publicKey,
      identityPublicKey: generateIdentity().publicKey,
      displayName: 'Beto',
      claimedAt: Date.now(),
    };
    await inyectar(invite, await sealClaim(invite.token, claimOtraWrap), 'device-otro');

    await processInvite(invite, 'device-ana');

    // El buzón se relee entero (sin cursor): el reclamo LEGÍTIMO de Beto se
    // reprocesa en la misma pasada y SÍ recibe su entrega (es el reintento
    // real, D2). El reclamo AJENO con otra wrap no es "el mismo reclamante":
    // Beto no está pinneado (nunca pasó por contacto), así que se rechaza
    // igual que cualquier otro miembro no pinneado. Sólo debe salir UN grant,
    // no dos.
    const topic = await deriveInviteTopic(invite.token);
    const sobres = relayMock.__buzones.get(topic) ?? [];
    // 2 reclamos (Beto original + el ajeno) + 1 sola entrega de Ana.
    expect(sobres).toHaveLength(3);
    expect(sobres.filter(e => e.sender === 'device-ana')).toHaveLength(1);
  });
});

describe('D3 (verifier T-151, ronda 1) · el rechazo por seguridad deja rastro', () => {
  it('un reclamo a nombre de un miembro pinneado sin prueba de posesión queda en el diagnóstico', async () => {
    const { invite } = anaInvitaConBeto();

    usar('beto', BETO);
    const identidadDeBeto = ensureIdentity().publicKey;
    const wrapDeBeto = ensureWrapKeypair().publicKey;

    usar('ana', ANA);
    savePeer(BETO.id, { secret: 'sec-beto', identityPublicKey: identidadDeBeto, wrapPublicKey: wrapDeBeto });

    const wrapDeMallory = generateWrapKeypair().publicKey;
    const claimFalso: InviteClaim = {
      kind: 'claim',
      groupId: invite.groupId,
      userId: BETO.id,
      wrapPublicKey: wrapDeMallory,
      identityPublicKey: identidadDeBeto,
      displayName: 'Beto',
      claimedAt: Date.now(),
    };
    await inyectar(invite, await sealClaim(invite.token, claimFalso), 'device-mallory');

    await processInvite(invite, 'device-ana');

    const entradas = listErrors();
    expect(entradas.some(e => e.message.includes('admit_rechazado'))).toBe(true);
    // Sin claves completas en el rastro.
    expect(entradas.some(e => e.message.includes(wrapDeMallory))).toBe(false);
    expect(entradas.some(e => e.message.includes(identidadDeBeto))).toBe(false);
  });

  it('un reclamo con userId de forma inválida queda en el diagnóstico', async () => {
    const { invite } = anaInvita();

    const claimInvalido: InviteClaim = {
      kind: 'claim',
      groupId: invite.groupId,
      userId: '__proto__',
      wrapPublicKey: generateWrapKeypair().publicKey,
      identityPublicKey: generateIdentity().publicKey,
      displayName: 'x',
      claimedAt: Date.now(),
    };
    await inyectar(invite, await sealClaim(invite.token, claimInvalido), 'device-mallory');

    await processInvite(invite, 'device-ana');

    const entradas = listErrors();
    expect(entradas.some(e => e.message.includes('openClaim_rechazado'))).toBe(true);
  });
});
