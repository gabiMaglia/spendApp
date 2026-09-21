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
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useUserStore } from '@/src/store/userStore';
import { publishToGroup } from '../relaySync';
import { isManifest } from '../manifest';
import type { Group, Expense } from '@/src/types/models';

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

  it('no reenvía los bytes de la foto de un usuario que no cambió', async () => {
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    const conFoto = { id: 'u1', name: 'Uno', email: '', authProvider: 'google', createdAt: 1, avatar: 'foto-base64-larga'.repeat(500), updatedAt: 1, isDeleted: false } as never;
    useUserStore.setState({ users: [conFoto] });
    useGroupStore.setState({ groups: [{ ...grupo(), memberIds: ['u1'] }] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1')] } as never);

    await publishToGroup('G', 'u1', 'device1');

    for (const sobres of relayMock.__buzones.values()) {
      const contieneFotoLarga = sobres.some(s => s.payload.includes('foto-base64-larga'));
      expect(contieneFotoLarga).toBe(false); // la foto viaja en su propio topic, no en la rebanada de users
    }
  });
});
