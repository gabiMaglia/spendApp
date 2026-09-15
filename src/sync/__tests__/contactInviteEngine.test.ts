import {
  publishContactClaim, processContactInvite, activeContactInvites, processAllContactInvites,
} from '../contactInviteEngine';
import { createContactInvite, type ContactInvite } from '../contactInvite';
import { ensureIdentity, saveContactInvite, listPendingContactClaims } from '@/src/store/identityStore';
import { getPeer } from '../contactChannel';
import { useAuthStore } from '@/src/store/authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

/**
 * El flujo del link de contacto completo, con los DOS dispositivos.
 *
 * Mismo patrón que `inviteEngine.test.ts`: un solo proceso de Jest no puede
 * tener dos storages a la vez, así que se alternan con `usar(dispositivo)`.
 *
 * Ojo con la trampa de T-096/Task 1: las claves de identidad/dispositivo NO
 * están scopeadas por cuenta (`identity_v1`, `wrapkeys_v1`, `device_id` — el
 * aparato), mientras que las invitaciones de contacto y los peers SÍ lo están
 * (`contact_invites_v1`, `contact_pending_claims_v1` en el storage `groupkeys`;
 * `contact_secret_v1`, `contact_peers_v1` en el storage `users`). Restaurar todo
 * como si fuera unscoped hace que el harness nunca reproduzca de verdad un
 * cambio de dispositivo — exactamente el bug que tenía la versión vieja de
 * `inviteEngine.test.ts` antes de corregirse.
 */

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

function usuario(id: string, name: string): User {
  return {
    id, name, email: `${id}@test.com`, authProvider: 'google',
    createdAt: 0, updatedAt: 0, isDeleted: false,
  };
}

const ANA     = usuario('u-ana', 'Ana');
const BETO    = usuario('u-beto', 'Beto');
const MALLORY = usuario('u-mallory', 'Mallory');

// --- alternancia de dispositivos ---------------------------------------------

// `groupkeys`: identity_v1/wrapkeys_v1/device_id son del APARATO (sin scope);
// contact_invites_v1/contact_pending_claims_v1 son de la CUENTA (T-098 · SEC L-4).
const CLAVES_APARATO_GROUPKEYS = ['identity_v1', 'wrapkeys_v1', 'device_id'];
const CLAVES_CUENTA_GROUPKEYS  = ['contact_invites_v1', 'contact_pending_claims_v1'];
// `users`: contact_secret_v1/contact_peers_v1 son de la CUENTA (contactChannel.ts usa writeScoped/readScoped).
const CLAVES_CUENTA_USERS = ['contact_secret_v1', 'contact_peers_v1'];

type Estado = {
  groupkeys: Record<string, string | undefined>;
  users: Record<string, string | undefined>;
  me: User;
};

const guardados = new Map<string, Estado>();
let actual: string | null = null;

function capturar(): Estado | null {
  if (!actual) return null;
  const groupkeysStorage = createSecureStorage('groupkeys');
  const usersStorage = createSecureStorage('users');
  const uid = useAuthStore.getState().currentUser!.id;
  return {
    groupkeys: Object.fromEntries([
      ...CLAVES_APARATO_GROUPKEYS.map(k => [k, groupkeysStorage.getString(k)]),
      ...CLAVES_CUENTA_GROUPKEYS.map(k => [k, groupkeysStorage.getString(`${k}::u:${uid}`)]),
    ]),
    users: Object.fromEntries(
      CLAVES_CUENTA_USERS.map(k => [k, usersStorage.getString(`${k}::u:${uid}`)]),
    ),
    me: useAuthStore.getState().currentUser!,
  };
}

/** Cambia de dispositivo. El primero de cada id arranca en blanco. */
function usar(id: string, me: User): void {
  const anterior = capturar();
  if (anterior && actual) guardados.set(actual, anterior);

  const groupkeysStorage = createSecureStorage('groupkeys');
  const usersStorage = createSecureStorage('users');
  groupkeysStorage.clearAll();
  usersStorage.clearAll();

  const estado = guardados.get(id);
  if (estado) {
    for (const k of CLAVES_APARATO_GROUPKEYS) {
      const v = estado.groupkeys[k];
      if (v !== undefined) groupkeysStorage.set(k, v);
    }
    // Se restauran con el ID NUEVO del usuario, no el viejo.
    for (const k of CLAVES_CUENTA_GROUPKEYS) {
      const v = estado.groupkeys[k];
      if (v !== undefined) groupkeysStorage.set(`${k}::u:${me.id}`, v);
    }
    for (const k of CLAVES_CUENTA_USERS) {
      const v = estado.users[k];
      if (v !== undefined) usersStorage.set(`${k}::u:${me.id}`, v);
    }
  }

  useAuthStore.setState({ currentUser: me });
  actual = id;
}

beforeEach(() => {
  relayMock.__reset();
  guardados.clear();
  actual = null;
  for (const id of ['groupkeys', 'users'] as const) createSecureStorage(id).clearAll();
});

// -----------------------------------------------------------------------------

describe('ingreso de contacto por link, de punta a punta', () => {
  it('primer reclamo válido: los dos quedan agregados mutuamente', async () => {
    relayMock.__reset();

    usar('ana', ANA);
    const invite = createContactInvite('Ana', ensureIdentity().publicKey);
    saveContactInvite(invite);

    usar('beto', BETO);
    const publicado = await publishContactClaim(invite, 'device-beto');
    expect(publicado).toBe(true);

    usar('ana', ANA);
    const adoptoAna = await processContactInvite(invite, 'device-ana');
    // Contrato de `processContactInvite` (T-096): devuelve `true` si pasó algo
    // nuevo de CUALQUIERA de los dos lados — admitir a alguien (quien
    // comparte) cuenta igual que recibir el grant (quien reclama), porque las
    // dos cosas dejan un peer nuevo guardado.
    expect(adoptoAna).toBe(true);
    expect(getPeer(BETO.id)).toBeDefined();

    usar('beto', BETO);
    const adoptoBeto = await processContactInvite(invite, 'device-beto');
    expect(adoptoBeto).toBe(true);
    expect(getPeer(ANA.id)).toBeDefined();
  });

  it('un segundo reclamante distinto no recibe grant', async () => {
    relayMock.__reset();

    usar('ana', ANA);
    const invite = createContactInvite('Ana', ensureIdentity().publicKey);
    saveContactInvite(invite);

    usar('beto', BETO);
    await publishContactClaim(invite, 'device-beto');
    usar('mallory', MALLORY);
    await publishContactClaim(invite, 'device-mallory');

    usar('ana', ANA);
    await processContactInvite(invite, 'device-ana');
    expect(getPeer(BETO.id)).toBeDefined();
    expect(getPeer(MALLORY.id)).toBeUndefined();

    usar('mallory', MALLORY);
    const adoptoMallory = await processContactInvite(invite, 'device-mallory');
    expect(adoptoMallory).toBe(false);
    expect(getPeer(ANA.id)).toBeUndefined();
  });

  it('el mismo reclamante puede reintentar después de haber sido admitido', async () => {
    relayMock.__reset();

    usar('ana', ANA);
    const invite = createContactInvite('Ana', ensureIdentity().publicKey);
    saveContactInvite(invite);

    usar('beto', BETO);
    await publishContactClaim(invite, 'device-beto');

    usar('ana', ANA);
    await processContactInvite(invite, 'device-ana');
    await processContactInvite(invite, 'device-ana');

    usar('beto', BETO);
    const adoptoBeto = await processContactInvite(invite, 'device-beto');
    expect(adoptoBeto).toBe(true);
    expect(getPeer(ANA.id)).toBeDefined();
  });
});

describe('lo que el buzón de invitación de contacto NO permite', () => {
  it('un tercero que sólo reclamó (nunca emitió) no admite a nadie más — un solo uso cross-device', async () => {
    // Éste es el caso crítico de T-096/Task 1: Mallory reclama, pero su
    // dispositivo NUNCA tiene un registro local de haber EMITIDO la
    // invitación (`findContactInviteToken` no la encuentra ahí) — sólo Ana
    // lo tiene. Si `admitContactClaim` sólo chequeara `actual?.claimedBy`
    // (undefined porque `actual` es undefined), un segundo reclamo pasaría
    // en silencio. El guard correcto es `if (!actual) return false` ANTES de
    // mirar `claimedBy`.
    relayMock.__reset();

    usar('ana', ANA);
    const invite = createContactInvite('Ana', ensureIdentity().publicKey);
    saveContactInvite(invite);

    usar('beto', BETO);
    await publishContactClaim(invite, 'device-beto');
    usar('mallory', MALLORY);
    await publishContactClaim(invite, 'device-mallory');

    // Ana (quien emitió) procesa: sólo Beto queda admitido.
    usar('ana', ANA);
    await processContactInvite(invite, 'device-ana');

    // Mallory nunca emitió la invitación — su dispositivo no tiene record de
    // ella en `contact_invites_v1`. Si Mallory "procesara" el mismo buzón
    // (rol de quien comparte, aunque ella nunca lo fue), no debe poder
    // admitir a nadie: no hay `actual` local del lado de Mallory.
    usar('mallory', MALLORY);
    const resultadoMallory = await processContactInvite(invite, 'device-mallory');
    // Mallory no recibió un grant dirigido a ella (Ana ya cerró con Beto), así
    // que tampoco hay novedad de su lado como reclamante.
    expect(resultadoMallory).toBe(false);
    expect(getPeer(ANA.id)).toBeUndefined();
    expect(getPeer(BETO.id)).toBeUndefined();
  });

  it('una invitación vencida no publica reclamo ni se procesa', async () => {
    relayMock.__reset();

    usar('ana', ANA);
    const invite = createContactInvite('Ana', ensureIdentity().publicKey);
    const vencida: ContactInvite = { ...invite, expiresAt: Date.now() - 1 };

    usar('beto', BETO);
    expect(await publishContactClaim(vencida, 'device-beto')).toBe(false);
    expect(await processContactInvite(vencida, 'device-beto')).toBe(false);
  });

  it('si el envío falla, el reclamo queda igual pendiente de reintento', async () => {
    relayMock.__reset();

    usar('ana', ANA);
    const invite = createContactInvite('Ana', ensureIdentity().publicKey);
    saveContactInvite(invite);

    usar('beto', BETO);
    relayMock.__estado.sinRed = true;

    expect(await publishContactClaim(invite, 'device-beto')).toBe(false);
    expect(listPendingContactClaims().map(i => i.token)).toEqual([invite.token]);
  });

  it('sin sesión no se publica nada', async () => {
    relayMock.__reset();

    usar('ana', ANA);
    const invite = createContactInvite('Ana', ensureIdentity().publicKey);
    saveContactInvite(invite);

    usar('beto', BETO);
    useAuthStore.setState({ currentUser: null });

    expect(await processContactInvite(invite, 'device-beto')).toBe(false);
  });
});

describe('activeContactInvites', () => {
  it('junta lo que emití y lo que estoy reclamando', () => {
    usar('ana', ANA);
    const invite = createContactInvite('Ana', ensureIdentity().publicKey);
    saveContactInvite(invite);
    expect(activeContactInvites().map(i => i.token)).toContain(invite.token);
  });
});

describe('processAllContactInvites', () => {
  it('procesa todos los buzones activos y devuelve si hubo alguna novedad', async () => {
    relayMock.__reset();

    usar('ana', ANA);
    const invite = createContactInvite('Ana', ensureIdentity().publicKey);
    saveContactInvite(invite);

    usar('beto', BETO);
    await publishContactClaim(invite, 'device-beto');

    usar('ana', ANA);
    const huboNovedad = await processAllContactInvites('device-ana');
    expect(huboNovedad).toBe(true);
    expect(getPeer(BETO.id)).toBeDefined();
  });

  it('sin invitaciones activas, no hay novedad', async () => {
    relayMock.__reset();
    usar('ana', ANA);
    expect(await processAllContactInvites('device-ana')).toBe(false);
  });
});
