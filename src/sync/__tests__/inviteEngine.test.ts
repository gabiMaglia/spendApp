import { publishClaim, processInvite, activeInvites } from '../inviteEngine';
import {
  createInvite, deriveInviteTopic, sealGrant, wrapGroupKey,
  generateIdentity, generateWrapKeypair, type GroupInvite,
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

const ANA  = usuario('u-ana', 'Ana');
const BETO = usuario('u-beto', 'Beto');

function usuario(id: string, name: string): User {
  return {
    id, name, email: `${id}@test.com`, authProvider: 'google',
    createdAt: 0, updatedAt: 0, isDeleted: false,
  };
}

function grupo(memberIds: string[]): Group {
  return {
    id: 'g1', name: 'Viaje', memberIds, currency: 'ARS',
    createdAt: 0, createdById: ANA.id, deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Group;
}

// --- alternancia de dispositivos ---------------------------------------------

const CLAVES = ['identity_v1', 'wrapkeys_v1', 'invites_v1', 'pending_joins_v1', 'device_id'];

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
  return {
    storage: Object.fromEntries(CLAVES.map(k => [k, storage.getString(k)])),
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
    for (const [k, v] of Object.entries(estado.storage)) if (v !== undefined) storage.set(k, v);
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

describe('activeInvites', () => {
  it('junta las emitidas y las aceptadas, sin repetir', async () => {
    const { invite } = anaInvita();
    saveInvite(invite);

    expect(activeInvites().map(i => i.token)).toEqual([invite.token]);
  });
});
