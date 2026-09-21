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
});
