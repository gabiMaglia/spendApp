import { publishToGroup, drainGroup } from '../relaySync';
import { signEnvelope } from '../envelopeSign';
import { sealEnvelope, deriveTopic, fromHex } from '../envelopeCrypto';
import { generateIdentity } from '../groupInvite';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Expense, Group, User } from '@/src/types/models';

/**
 * El buzón de un grupo es público: cualquiera que conozca el `topic` puede
 * escribir. Lo que NO puede es hacer pasar lo suyo por un sobre legítimo.
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
      const l = buzones.get(topic) ?? [];
      l.push({ seq: ++seq, topic, payload, sender, created_at: '' });
      buzones.set(topic, l);
      return { ok: true, seq };
    },
    fetchSince: async (topic: string, since: number, exclude?: string) => {
      const todos = (buzones.get(topic) ?? [])
        .filter(e => e.seq > since && (!exclude || e.sender !== exclude));
      return { ok: true, envelopes: todos, cursor: todos.length ? todos.at(-1)!.seq : since };
    },
  };
});

const relayMock = jest.requireMock('../relay') as {
  __buzones: Map<string, { seq: number; payload: string; sender: string }[]>;
  __reset: () => void;
};

const ANA = { id: 'ana', name: 'Ana' } as User;
const meta = { updatedAt: 1_000, isDeleted: false };

const grupo = (): Group => ({
  id: 'G', name: 'Asado', memberIds: ['ana', 'beto'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], ...meta,
} as Group);

const gasto = (id: string, desc: string): Expense => ({
  id, groupId: 'G', description: desc, amount: 1000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal', splits: [], category: 'food', date: 0,
  createdAt: 0, createdById: 'ana', deletionVotes: [], ...meta,
} as Expense);

async function topicDelGrupo(): Promise<string> {
  const rec = useGroupKeyStore.getState().getKey('G')!;
  return deriveTopic(fromHex(rec.key), rec.epoch);
}

beforeEach(() => {
  relayMock.__reset();
  createSecureStorage('groupkeys').clearAll();
  createSecureStorage('groups').clearAll();
  useAuthStore.setState({ currentUser: ANA });
  useGroupStore.setState({ groups: [grupo()] });
  useExpenseStore.setState({ expenses: [gasto('e1', 'Carne')] });
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
});

describe('publicar y drenar con firma', () => {
  it('lo propio, firmado, se aplica del otro lado', async () => {
    await publishToGroup('G', 'ana', 'dev-ana');

    useExpenseStore.setState({ expenses: [] });
    const r = await drainGroup('G', 'beto', 'dev-beto', 0);

    expect(r.ok && r.applied).toBe(1);
    expect(useExpenseStore.getState().expenses.map(e => e.id)).toEqual(['e1']);
  });

  it('el sobre que sale del relay va firmado', async () => {
    await publishToGroup('G', 'ana', 'dev-ana');

    const sobre = relayMock.__buzones.get(await topicDelGrupo())![0]!;
    const wrapper = JSON.parse(sobre.payload);

    expect(wrapper.k).toBeTruthy();
    expect(wrapper.s).toBeTruthy();
    expect(sobre.payload).not.toContain('Carne'); // sigue cifrado
  });
});

describe('lo que el buzón no deja pasar', () => {
  it('basura inyectada por alguien sin la clave se saltea', async () => {
    const topic = await topicDelGrupo();
    relayMock.__buzones.set(topic, [{ seq: 1, payload: 'basura', sender: 'dev-x' }]);

    const r = await drainGroup('G', 'beto', 'dev-beto', 0);

    expect(r.ok && r.applied).toBe(0);
    expect(r.ok && r.skipped).toBe(1);
  });

  // Un sobre sin firma es el formato viejo o un inyector: se descarta. No se
  // pierde nada, porque los sobres llevan ESTADO y la próxima publicación
  // reemplaza lo que haya.
  it('un sobre bien cifrado pero SIN firmar se rechaza', async () => {
    const rec = useGroupKeyStore.getState().getKey('G')!;
    const sellado = sealEnvelope(fromHex(rec.key), JSON.stringify({
      version: 1, fromUserId: 'ana', timestamp: 0,
      groups: [], expenses: [gasto('e9', 'Colado')], payments: [], users: [],
    }));
    relayMock.__buzones.set(await topicDelGrupo(), [{ seq: 1, payload: sellado, sender: 'dev-x' }]);

    useExpenseStore.setState({ expenses: [] });
    await drainGroup('G', 'beto', 'dev-beto', 0);

    expect(useExpenseStore.getState().expenses).toEqual([]);
  });

  /**
   * ⚠️ LO QUE LA FIRMA **NO** HACE, y conviene que esté escrito.
   *
   * La firma autentica el SOBRE, no lo que hay adentro. Quien tiene la clave
   * del grupo puede fabricar registros a nombre de cualquiera: `createdById` y
   * `paidById` son datos como cualquier otro y el merge no los verifica.
   *
   * Este test existe para que nadie crea que el problema está resuelto.
   * Cerrarlo de verdad exige firmar CADA REGISTRO con la clave de su autor
   * (T-041), no vigilar el remitente del sobre.
   */
  it('DOCUMENTA: la firma NO impide fabricar registros a nombre de otro', async () => {
    const rec = useGroupKeyStore.getState().getKey('G')!;
    const otroMiembro = generateIdentity();
    const sellado = sealEnvelope(fromHex(rec.key), JSON.stringify({
      version: 1, fromUserId: 'beto', timestamp: 0,
      groups: [], payments: [], users: [],
      expenses: [{ ...gasto('e9', 'Gasto que Ana nunca hizo'), createdById: 'ana', paidById: 'ana' }],
    }));
    relayMock.__buzones.set(await topicDelGrupo(), [{
      seq: 1, payload: signEnvelope(sellado, otroMiembro.privateKey), sender: 'dev-beto',
    }]);

    useExpenseStore.setState({ expenses: [] });
    await drainGroup('G', 'caro', 'dev-caro', 0);

    expect(useExpenseStore.getState().expenses[0]?.createdById).toBe('ana');
  });

  // Cualquier dispositivo de cualquier miembro publica sin trámite previo: la
  // credencial de pertenencia es la clave del grupo, no una lista aparte.
  it('un dispositivo que nadie vio antes publica sin problema', async () => {
    const nuevo = generateIdentity();
    const rec = useGroupKeyStore.getState().getKey('G')!;
    const sellado = sealEnvelope(fromHex(rec.key), JSON.stringify({
      version: 1, fromUserId: 'caro', timestamp: 0,
      groups: [], expenses: [gasto('e5', 'De Caro')], payments: [], users: [],
    }));
    relayMock.__buzones.set(await topicDelGrupo(), [{
      seq: 1, payload: signEnvelope(sellado, nuevo.privateKey), sender: 'dev-caro',
    }]);

    useExpenseStore.setState({ expenses: [] });
    await drainGroup('G', 'beto', 'dev-beto', 0);

    expect(useExpenseStore.getState().expenses.map(e => e.id)).toEqual(['e5']);
  });

  it('un sobre ajeno no frena la cola: los buenos se aplican igual', async () => {
    await publishToGroup('G', 'ana', 'dev-ana');
    const topic = await topicDelGrupo();
    relayMock.__buzones.get(topic)!.unshift({ seq: 0, payload: 'basura', sender: 'dev-x' });

    useExpenseStore.setState({ expenses: [] });
    const r = await drainGroup('G', 'beto', 'dev-beto', -1);

    expect(r.ok && r.applied).toBe(1);
    expect(r.ok && r.skipped).toBe(1);
  });
});
