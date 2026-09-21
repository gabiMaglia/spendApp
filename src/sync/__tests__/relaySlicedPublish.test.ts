jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string }[]>();
  let seq = 0;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false, ckey?: string) => {
      const lista = buzones.get(topic) ?? [];
      lista.push({ seq: ++seq, topic, payload, sender, compactable, ckey });
      buzones.set(topic, lista);
      return { ok: true, seq };
    },
    fetchSince: async (topic: string, since: number) => {
      const lista = (buzones.get(topic) ?? []).filter(e => e.seq > since);
      return { ok: true, envelopes: lista, cursor: lista.length ? lista[lista.length - 1].seq : since };
    },
  };
});

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore, groupKeyBytes } from '@/src/store/groupKeyStore';
import { useUserStore } from '@/src/store/userStore';
import { publishToGroup } from '../relaySync';
import { isManifest } from '../manifest';
import { openEnvelope } from '../envelopeCrypto';
import { verifyEnvelope } from '../envelopeSign';
import * as sliceRenewal from '../sliceRenewal';
import type { Group, Expense, User } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as {
  __buzones: Map<string, { ckey?: string; compactable?: boolean; payload: string }[]>;
  __reset: () => void;
};

function grupo(): Group {
  return {
    id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD',
    createdAt: 1, createdById: 'u1', deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Group;
}

function gasto(id: string): Expense {
  return {
    id, groupId: 'G', description: 'x'.repeat(2_000), amount: 10, currency: 'USD',
    paidById: 'u1', splits: [{ userId: 'u1', amount: 10, isPaid: false }], splitMode: 'equal',
    category: 'other', date: 1, createdAt: 1, createdById: 'u1', deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Expense;
}

describe('publishToGroup publica rebanadas + manifiesto', () => {
  beforeEach(() => {
    relayMock.__reset();
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().ensureKey('G');
    useGroupStore.setState({ groups: [grupo()] } as never);
    const muchosGastos = Array.from({ length: 200 }, (_, i) => gasto(`e${i}`));
    useExpenseStore.setState({ expenses: muchosGastos } as never);
  });

  it('manda más de un sobre para un grupo grande, y el último es un manifiesto', async () => {
    const result = await publishToGroup('G', 'u1', 'device1');
    expect(result.ok).toBe(true);

    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)!;
    expect(sobres.length).toBeGreaterThan(1);

    // Todos menos potencialmente el manifiesto llevan ckey y son compactable.
    for (const sobre of sobres) {
      expect(sobre.compactable).toBe(true);
      expect(sobre.ckey).toBeTruthy();
    }
  });

  it('el manifiesto declara una ckey por cada rebanada de datos publicada', async () => {
    await publishToGroup('G', 'u1', 'device1');
    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)!;

    // El sobre de manifiesto es identificable porque su ckey es distinta de
    // las de datos y su payload (una vez abierto) cumple isManifest. Acá se
    // verifica indirectamente contando: K rebanadas de datos + 1 manifiesto.
    const ckeys = new Set(sobres.map(s => s.ckey));
    expect(ckeys.size).toBe(sobres.length); // cada rebanada (y el manifiesto) tiene su propia ckey única
  });

  it('no reenvía los bytes de la foto en la rebanada de users, pero sí los publica aparte', async () => {
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    const fotoOriginal = 'foto-base64-larga'.repeat(500);
    const conFoto = { id: 'u1', name: 'Uno', email: '', authProvider: 'google', createdAt: 1, avatar: fotoOriginal, updatedAt: 1, isDeleted: false } as never;
    useUserStore.setState({ users: [conFoto] });
    useGroupStore.setState({ groups: [{ ...grupo(), memberIds: ['u1'] }] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1')] } as never);

    await publishToGroup('G', 'u1', 'device1');

    // Superficialmente esto ya era cierto en el código VIEJO (roto): todo
    // payload es ciphertext base64, así que un substring en claro nunca iba a
    // aparecer en él, hubiera o no elisión real. La única forma de probar que
    // la elisión ocurrió es DESCIFRAR cada sobre con la clave real del grupo
    // (mismo mecanismo que usa `drainGroup`) y mirar el contenido en claro.
    const key = groupKeyBytes('G')!;
    expect(key).toBeTruthy();

    const decrypted: { topic: string; content: unknown; raw: string }[] = [];
    for (const [topic, sobres] of relayMock.__buzones.entries()) {
      for (const sobre of sobres) {
        const firmado = verifyEnvelope(sobre.payload);
        expect(firmado).not.toBeNull();
        const plain = openEnvelope(key, firmado!.sealed);
        expect(plain).not.toBeNull();
        let content: unknown = plain;
        try { content = JSON.parse(plain!); } catch { /* la foto viaja como string plano, no JSON */ }
        decrypted.push({ topic, content, raw: plain! });
      }
    }

    // (a) la rebanada `users` (JSON, no manifiesto) trae `avatarDigest` y
    // NUNCA los bytes reales de la foto para u1.
    const rebanadaUsers = decrypted.find(d =>
      typeof d.content === 'object' && d.content !== null && !isManifest(d.content) &&
      Array.isArray((d.content as { users?: unknown }).users) &&
      ((d.content as { users: User[] }).users.length > 0));
    expect(rebanadaUsers).toBeDefined();
    const perfilU1 = (rebanadaUsers!.content as { users: User[] }).users.find(u => u.id === 'u1');
    expect(perfilU1).toBeDefined();
    expect(perfilU1!.avatar).toBeFalsy();
    expect(perfilU1!.avatarDigest).toBeTruthy();

    // (b) existe un sobre APARTE (otro topic, no el del grupo) cuyo contenido
    // descifrado ES la foto real, byte a byte.
    const sobreDeFoto = decrypted.find(d => d.raw === fotoOriginal);
    expect(sobreDeFoto).toBeDefined();
    expect(sobreDeFoto!.topic).not.toBe(rebanadaUsers!.topic);
  });

  /**
   * Revisión final, Fix 2 (crítico): antes, `avatarDigest` se recalculaba
   * para CUALQUIER usuario con `avatar` cacheado localmente — no sólo para el
   * propio (`fromUserId`). Si este dispositivo tiene una copia STALE de la
   * foto de OTRO miembro (nunca la actualizó, o la cacheó hace tiempo), y
   * republica el grupo por cualquier motivo no relacionado a fotos, declararía
   * esa versión vieja como "la" versión — un tercero que confía en el digest
   * la adoptaría vía `fetchAvatarIfMissing` → `addOrUpdateUser`, que escribe
   * DIRECTO al store sin LWW, potencialmente pisando una foto más nueva.
   *
   * El fix: sólo se recalcula el digest para el registro cuyo `id` coincide
   * con `fromUserId` (el propio). Para cualquier otro, el `avatar` se elide
   * (nunca se reenvían fotos ajenas completas) pero `avatarDigest` se deja
   * TAL CUAL venía en la fila local — nunca se recalcula a partir de bytes
   * cacheados de otro usuario.
   */
  it('no recalcula avatarDigest para un usuario que no es el remitente — no reafirma frescura de una foto ajena', async () => {
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    const fotoStaleDeOtro = 'foto-stale-cacheada-de-u2'.repeat(50);
    const propio = { id: 'u1', name: 'Uno', email: '', authProvider: 'google', createdAt: 1, updatedAt: 1, isDeleted: false } as never;
    // u2: copia local STALE de su foto, SIN un avatarDigest propio guardado
    // (nunca se recibió por referencia, o es un registro viejo).
    const otroConFotoStale = { id: 'u2', name: 'Dos', email: '', authProvider: 'google', createdAt: 1, avatar: fotoStaleDeOtro, updatedAt: 1, isDeleted: false } as never;
    useUserStore.setState({ users: [propio, otroConFotoStale] });
    useGroupStore.setState({ groups: [{ ...grupo(), memberIds: ['u1', 'u2'] }] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1')] } as never);

    await publishToGroup('G', 'u1', 'device1');

    const key = groupKeyBytes('G')!;
    let rebanadaUsersContenido: { users: User[] } | undefined;
    for (const sobres of relayMock.__buzones.values()) {
      for (const sobre of sobres) {
        const firmado = verifyEnvelope(sobre.payload);
        if (!firmado) continue;
        const plain = openEnvelope(key, firmado.sealed);
        if (!plain) continue;
        let content: unknown;
        try { content = JSON.parse(plain); } catch { continue; }
        if (
          typeof content === 'object' && content !== null && !isManifest(content) &&
          Array.isArray((content as { users?: unknown }).users) &&
          ((content as { users: User[] }).users.length > 0)
        ) {
          rebanadaUsersContenido = content as { users: User[] };
        }
      }
    }

    expect(rebanadaUsersContenido).toBeDefined();
    const perfilU2 = rebanadaUsersContenido!.users.find(u => u.id === 'u2');
    expect(perfilU2).toBeDefined();
    // El blob de la foto ajena nunca se reenvía completo...
    expect(perfilU2!.avatar).toBeFalsy();
    // ...pero tampoco se le asigna un avatarDigest "fresco" calculado acá:
    // como u2 no tenía uno propio guardado, no se declara ninguno.
    expect(perfilU2!.avatarDigest).toBeUndefined();
  });

  it('para un usuario ajeno, un avatarDigest YA existente en la fila local se deja tal cual — nunca se recalcula', async () => {
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    const propio = { id: 'u1', name: 'Uno', email: '', authProvider: 'google', createdAt: 1, updatedAt: 1, isDeleted: false } as never;
    // u2 ya trae un avatarDigest conocido de un merge anterior — distinto del
    // digest real de los bytes que este dispositivo tiene cacheados, a
    // propósito: si el código lo recalculara, este valor cambiaría.
    const digestConocidoAnterior = 'digest-conocido-de-un-merge-anterior';
    const otro = {
      id: 'u2', name: 'Dos', email: '', authProvider: 'google', createdAt: 1,
      avatar: 'bytes-cacheados-que-no-coinciden-con-el-digest'.repeat(20),
      avatarDigest: digestConocidoAnterior,
      updatedAt: 1, isDeleted: false,
    } as never;
    useUserStore.setState({ users: [propio, otro] });
    useGroupStore.setState({ groups: [{ ...grupo(), memberIds: ['u1', 'u2'] }] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1')] } as never);

    await publishToGroup('G', 'u1', 'device1');

    const key = groupKeyBytes('G')!;
    let rebanadaUsersContenido: { users: User[] } | undefined;
    for (const sobres of relayMock.__buzones.values()) {
      for (const sobre of sobres) {
        const firmado = verifyEnvelope(sobre.payload);
        if (!firmado) continue;
        const plain = openEnvelope(key, firmado.sealed);
        if (!plain) continue;
        let content: unknown;
        try { content = JSON.parse(plain); } catch { continue; }
        if (
          typeof content === 'object' && content !== null && !isManifest(content) &&
          Array.isArray((content as { users?: unknown }).users) &&
          ((content as { users: User[] }).users.length > 0)
        ) {
          rebanadaUsersContenido = content as { users: User[] };
        }
      }
    }

    const perfilU2 = rebanadaUsersContenido!.users.find(u => u.id === 'u2');
    expect(perfilU2!.avatar).toBeFalsy();
    expect(perfilU2!.avatarDigest).toBe(digestConocidoAnterior);
  });

  /**
   * Revisión final, Fix 3: antes, `recordSlicePublished` se llamaba al ARMAR
   * cada pieza (`buildSlicedEnvelopes`), antes de que `sendEnvelope` la
   * mandara de verdad. Si el envío fallaba a mitad de camino, piezas que
   * NUNCA llegaron al buzón quedaban igual marcadas como "recién publicadas"
   * en el registro de renovación de 20 días — así que la renovación nunca las
   * reintentaría.
   */
  it('recordSlicePublished sólo se registra para las piezas cuyo envío se confirmó', async () => {
    const renewalSpy = jest.spyOn(sliceRenewal, 'recordSlicePublished');

    // Se fuerza que el SEGUNDO envío de esta publicación falle — simula una
    // red que se cae a mitad de una publicación con varias piezas.
    let llamados = 0;
    const relayModule = jest.requireMock('../relay') as {
      sendEnvelope: (topic: string, payload: string, sender: string, compactable?: boolean, ckey?: string) => Promise<{ ok: boolean; seq?: number; reason?: string }>;
    };
    const sendEnvelopeOriginal = relayModule.sendEnvelope;
    relayModule.sendEnvelope = jest.fn(async (topic, payload, sender, compactable, ckey) => {
      llamados++;
      if (llamados === 2) return { ok: false, reason: 'network' };
      return sendEnvelopeOriginal(topic, payload, sender, compactable, ckey);
    });

    const result = await publishToGroup('G', 'u1', 'device1');
    expect(result.ok).toBe(false);

    // Sólo la primera pieza (la única cuyo envío se confirmó) quedó
    // registrada como "recién publicada".
    expect(renewalSpy).toHaveBeenCalledTimes(1);

    relayModule.sendEnvelope = sendEnvelopeOriginal;
    renewalSpy.mockRestore();
  });
});
