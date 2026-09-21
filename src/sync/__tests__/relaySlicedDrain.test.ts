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
    deleteMyEnvelopes: async () => ({ ok: true }),
  };
});

// Sin esto, drainGroup dispara consultas de red reales al directorio de
// autores (authorHealth/authorKeys) — diagnóstico fuera de banda, no
// relevante para lo que este test verifica.
jest.mock('../authorHealth', () => ({ observeAuthor: jest.fn() }));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { publishToGroup, drainGroup } from '../relaySync';
import { manifestGapFor, clearManifestGaps } from '../manifestHealth';
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

describe('drainGroup aplica rebanadas y detecta manifiestos incompletos', () => {
  beforeEach(() => {
    relayMock.__reset();
    clearManifestGaps();
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().ensureKey('G');
  });

  it('reconstruye el estado completo leyendo todas las rebanadas', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    const gastos = Array.from({ length: 200 }, (_, i) => gasto(`e${i}`));
    useExpenseStore.setState({ expenses: gastos } as never);
    await publishToGroup('G', 'u1', 'device1');

    // Un segundo "dispositivo" (mismo store en este test, cursor en 0) drena.
    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'device2', 0);
    expect(result.ok).toBe(true);
    expect(useExpenseStore.getState().expenses.length).toBe(200);
    expect(manifestGapFor('G')).toBeNull();
  });

  it('si falta una rebanada declarada por el manifiesto, marca el gap y NO rompe el resto', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)!;
    sobres.splice(0, 1); // se "pierde" la primera rebanada de datos

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'device2', 0);
    expect(result.ok).toBe(true); // el drenaje en sí no falla
    expect(manifestGapFor('G')).not.toBeNull();
    expect(manifestGapFor('G')!.missingCkeys.length).toBeGreaterThan(0);
  });

  /**
   * Revisión de Task 6, hallazgo #2: el chequeo pooleaba ckeys de TODOS los
   * remitentes. `ckey` se deriva de `(clave del grupo, campo, primer id de la
   * rebanada)` — nada del remitente entra en la fórmula — así que dos
   * dispositivos que publican el MISMO estado (plausible: ambos ya
   * sincronizados republicando) producen ckeys IDÉNTICAS. Si a uno de los dos
   * le falta esa rebanada en el buzón, el chequeo pooleado la daba por
   * recibida igual porque el otro remitente sí la mandó — un gap real quedaba
   * enmascarado.
   */
  it('el gap del manifiesto de un remitente NO se enmascara con la ckey (colisionada) de otro remitente', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);

    // Dos "dispositivos" publican el MISMO estado de grupo: mismas entidades,
    // mismo orden → mismas ckeys (la fórmula no depende del remitente).
    await publishToGroup('G', 'u1', 'deviceA');
    await publishToGroup('G', 'u1', 'deviceB');

    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)! as unknown as { sender: string; ckey?: string }[];

    // Se pierde la rebanada de `expenses` de deviceA (no el manifiesto).
    const idxDataA = sobres.findIndex(s => s.sender === 'deviceA' && s.ckey && !esManifiesto(sobres, s));
    expect(idxDataA).toBeGreaterThanOrEqual(0);
    const ckeyPerdida = sobres[idxDataA]!.ckey!;
    sobres.splice(idxDataA, 1);

    // deviceB SÍ mandó una rebanada con esa misma ckey (colisión de contenido
    // idéntico) — bajo el chequeo pooleado viejo, esto tapaba el gap de A.
    expect(sobres.some(s => s.sender === 'deviceB' && s.ckey === ckeyPerdida)).toBe(true);

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'deviceC', 0);
    expect(result.ok).toBe(true);
    expect(manifestGapFor('G')).not.toBeNull();
    expect(manifestGapFor('G')!.missingCkeys).toContain(ckeyPerdida);
  });

  /**
   * Revisión de Task 6, hallazgo #2 (segunda mitad): el gap real de un
   * remitente incompleto no debe "contaminar" al remitente completo — cada
   * manifiesto se mide contra las rebanadas DE SU PROPIO remitente.
   */
  it('un remitente completo no aparece falsamente afectado por el gap real de otro remitente', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);

    // deviceA publica su propio estado completo (e1, e2).
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);
    await publishToGroup('G', 'u1', 'deviceA');

    // deviceB publica un estado DISTINTO (e3, e4) → ckeys distintas de las de A.
    useExpenseStore.setState({ expenses: [gasto('e3'), gasto('e4')] } as never);
    await publishToGroup('G', 'u1', 'deviceB');

    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)! as unknown as { sender: string; ckey?: string }[];

    // A deviceB se le pierde su rebanada de EXPENSES (no la de `groups`: esa
    // es idéntica a la de deviceA por contenido y perderla no impediría que
    // e3/e4 se apliquen). `SLICED_FIELDS` manda `groups` antes que `expenses`,
    // así que es la SEGUNDA rebanada de datos de deviceB en orden de envío.
    const dataDeB = sobres.filter(s => s.sender === 'deviceB' && s.ckey && !esManifiesto(sobres, s));
    expect(dataDeB.length).toBeGreaterThanOrEqual(2);
    const ckeyPerdidaDeB = dataDeB[1]!.ckey!;
    const idxDataB = sobres.indexOf(dataDeB[1]!);
    sobres.splice(idxDataB, 1);

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'deviceC', 0);
    expect(result.ok).toBe(true);
    expect(useExpenseStore.getState().expenses.map(e => e.id).sort()).toEqual(['e1', 'e2']);

    const gap = manifestGapFor('G');
    expect(gap).not.toBeNull();
    // El único faltante es el de deviceB — deviceA (completo) no aporta nada.
    expect(gap!.missingCkeys).toEqual([ckeyPerdidaDeB]);
  });

  /**
   * Revisión de Task 6, hallazgo #3: si `fetchSince` devuelve exactamente el
   * límite del drenaje, puede haber más sobres esperando en el servidor —el
   * manifiesto o sus rebanadas podrían estar en la página siguiente— y
   * calcular un gap acá sería un falso positivo sin mitigación posible. El
   * chequeo debe saltearse entero para esta vuelta.
   */
  it('con la página llena al límite del drenaje, NO se registra ningún gap aunque falte una rebanada', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)! as unknown as { seq: number; topic: string; payload: string; sender: string; ckey?: string }[];

    // Se pierde una rebanada de datos: sin el chequeo #3, esto generaría un gap.
    const idxData = sobres.findIndex(s => s.ckey && !esManifiesto(sobres, s));
    sobres.splice(idxData, 1);

    // Se rellena el buzón con sobres basura hasta llegar EXACTO al límite de
    // `fetchSince` (200) que usa `drainGroup` — simula que hay más allá de lo
    // que esta página trajo.
    let seq = Math.max(...sobres.map(s => s.seq), 0);
    while (sobres.length < 200) {
      sobres.push({ seq: ++seq, topic, payload: 'basura-no-descifra', sender: 'ajeno' });
    }
    expect(sobres.length).toBe(200);

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'device2', 0);
    expect(result.ok).toBe(true);
    expect(manifestGapFor('G')).toBeNull();
  });
});

/** El sobre de manifiesto es el único, por remitente, sin `ckey` de dato real —
 * en este mock alcanza con buscar el payload más largo o, más simple, marcar
 * por posición: `publishToGroup` manda el manifiesto SIEMPRE al final de los
 * suyos. Para no depender de eso, se identifica desencriptando... pero eso
 * duplicaría el motor de cripto acá. Más simple y robusto: el manifiesto es
 * el ÚNICO sobre de ese remitente cuya `ckey` NO coincide con ninguna de las
 * ckeys de datos — pero como no tenemos esa lista a mano en el helper, se usa
 * la heurística de que es el ÚLTIMO sobre de ese remitente en el array (orden
 * de inserción == orden de envío, y el manifiesto siempre se manda último).
 */
function esManifiesto(
  todos: { sender: string }[],
  sobre: { sender: string },
): boolean {
  const delMismoRemitente = todos.filter(s => s.sender === sobre.sender);
  return delMismoRemitente[delMismoRemitente.length - 1] === sobre;
}
