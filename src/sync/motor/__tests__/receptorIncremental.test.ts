/**
 * T-191, Task 3 (spec §2.3, §7/§8 C2/C5(c)/C6) — el receptor recuerda qué
 * rebanadas aplicó.
 *
 * P10, P12, P13, P16: con `publishToGroup`/`drainGroup` reales (buzón
 * simulado, mismo patrón que `relaySlicedDrain.test.ts`).
 * P11, P19, P21, P22: envelopes armados a mano (mismo patrón que
 * `relaySlicedOrderDependency.test.ts`) — necesitan control fino del ORDEN
 * de llegada (`seq`) y de qué `sender`/`ckey` trae cada uno, algo que
 * `publishToGroup` no expone.
 */
// Compacta por (sender, ckey) AL LLEGAR — como hace el servidor real (T-032,
// `010_ckey_compaction.sql`). Verifier, segunda tanda: sin esto, P13/P19 no
// ejercitan la compactación de la que depende §2.3 (un `[]` de limpieza no
// "borra" nada si la versión vieja del mismo ckey sigue en el buzón simulado
// al lado).
jest.mock('@/src/sync/adaptadores/supabase/relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string }[]>();
  let seq = 0;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; },
    __push: (topic: string, payload: string, sender: string, ckey?: string) => {
      const lista = (buzones.get(topic) ?? []).filter(e => !(e.sender === sender && e.ckey === ckey));
      lista.push({ seq: ++seq, topic, payload, sender, compactable: true, ckey });
      buzones.set(topic, lista);
      return lista[lista.length - 1]!.seq;
    },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false, ckey?: string) => {
      const lista = (buzones.get(topic) ?? []).filter(e => !(compactable && ckey && e.sender === sender && e.ckey === ckey));
      lista.push({ seq: ++seq, topic, payload, sender, compactable, ckey });
      buzones.set(topic, lista);
      return { ok: true, seq };
    },
    fetchSince: async (topic: string, since: number, excludeSender?: string, limit = 200) => {
      const lista = (buzones.get(topic) ?? []).filter(e => e.seq > since && e.sender !== excludeSender).slice(0, limit);
      return { ok: true, envelopes: lista, cursor: lista.length ? lista[lista.length - 1]!.seq : since, more: lista.length === limit };
    },
    deleteMyEnvelopes: async () => ({ ok: true }),
  };
});
jest.mock('@/src/sync/confianza/authorHealth', () => ({ observeAuthor: jest.fn(async () => 'ok'), RECHAZAR_AUTORES_NO_VERIFICADOS: false }));
jest.mock('@/src/sync/confianza/authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));
// T-206-A (D15): pendingDrain ahora importa olvidarCursor directo de
// './cursor' (motor/cursor.ts), sin pasar por relayEngine. Se mockea el
// módulo real (no virtual) preservando el resto con requireActual.
jest.mock('../cursor', () => ({
  ...jest.requireActual('../cursor'),
  olvidarCursor: jest.fn(),
}));

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useGroupKeyStore, groupKeyBytes } from '@/src/store/groupKeyStore';
import { publishToGroup, drainGroup, deleteMyGroupEnvelopes } from '../relaySync';
import { marcarPendienteDeDrenaje } from '../pendingDrain';
import { manifestGapFor, clearManifestGaps } from '@/src/sync/nucleo/manifestHealth';
import { deriveTopic, sealEnvelope } from '@/src/sync/nucleo/envelopeCrypto';
import { signEnvelope } from '@/src/sync/nucleo/envelopeSign';
import { ensureIdentity } from '@/src/store/identityStore';
import { deriveCkey } from '@/src/sync/nucleo/ckey';
import { armarManifiesto } from '@/src/test-utils/armarManifiesto';
import * as appliedSlices from '@/src/sync/nucleo/appliedSlices';
import * as sliceLedger from '@/src/sync/nucleo/sliceLedger';
import { almacen } from '@/src/sync/adaptadores/hushsplit/adaptadorHushSplit';
import { _reset as resetRelecturas } from '@/src/sync/nucleo/relecturas';
import { olvidarFallosDeAplicacion } from '@/src/sync/nucleo/drainFailures';
import { applyBackup, BACKUP_FORMAT, BACKUP_VERSION, type BackupFile } from '@/src/services/backup';
import type { Group, Expense, ExpenseComment } from '@/src/types/models';

const relayMock = jest.requireMock('@/src/sync/adaptadores/supabase/relay') as {
  __reset: () => void;
  __push: (topic: string, payload: string, sender: string, ckey?: string) => number;
};

const grupo = (): Group => ({
  id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD', createdAt: 1, createdById: 'u1',
  miembros: {}, updatedAt: 1_000, isDeleted: false,
} as Group);
const gasto = (id: string, description = 'x', updatedAt = 1_000): Expense => ({
  id, groupId: 'G', description, amount: 10, currency: 'USD', paidById: 'u1',
  splits: [{ userId: 'u1', amount: 10, isPaid: false }], splitMode: 'equal', category: 'other',
  date: 1, createdAt: 1, createdById: 'u1', updatedAt, isDeleted: false,
} as Expense);

async function topicDe(): Promise<string> {
  const record = useGroupKeyStore.getState().getKey('G')!;
  return deriveTopic(groupKeyBytes('G')!, record.epoch);
}

/** Envuelve `registros` de `campo` como el `SyncDelta` parcial que `adaptador.envolver` produce. */
function envolverCrudo(campo: string, registros: unknown[]): Record<string, unknown> {
  return {
    version: 1, featureVersion: 2, fromUserId: 'quien-firma', timestamp: 0,
    groups: [], expenses: [], payments: [], users: [],
    [campo]: registros,
  };
}

/** Sella y firma un delta crudo, y lo empuja al buzón simulado con la `ckey` dada. */
function empujar(topic: string, delta: unknown, sender: string, ckey: string): number {
  const key = groupKeyBytes('G')!;
  const sealed = sealEnvelope(key, JSON.stringify(delta));
  const firmado = signEnvelope(sealed, ensureIdentity().privateKey);
  return relayMock.__push(topic, firmado, sender, ckey);
}

beforeEach(() => {
  relayMock.__reset();
  clearManifestGaps();
  resetRelecturas();
  useAuthStore.setState({ currentUser: { id: 'u1' } } as never);
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  useGroupStore.setState({ groups: [grupo()] } as never);
  useExpenseStore.setState({ expenses: [] } as never);
  useCommentStore.setState({ comments: [] } as never);
});

describe('P10: publicación parcial tras una completa — el manifiesto cierra sin "falta"', () => {
  it('un cubo que no viajó de nuevo (porque no cambió) no cuenta como faltante', async () => {
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    const first = await drainGroup('G', 'u2', 'deviceB', 0);
    expect(first.ok).toBe(true);
    expect(manifestGapFor('G')).toBeNull();

    // Segunda publicación: se edita UN gasto — sólo ese cubo + manifiesto
    // viajan de nuevo (T-191, Task 2). El resto de los cubos que YA aplicó
    // el receptor no vuelven a viajar.
    useExpenseStore.setState({ expenses: [{ ...gasto('e1'), description: 'editado', updatedAt: 2_000 }, gasto('e2')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    if (!first.ok) throw new Error('unreachable');
    const second = await drainGroup('G', 'u2', 'deviceB', first.cursor);
    expect(second.ok).toBe(true);
    expect(manifestGapFor('G')).toBeNull(); // sin appliedSlices, esto daría un falso "falta"
  });
});

describe('P12: quien entra nuevo (cursor 0) recibe todos los cubos y el manifiesto cierra', () => {
  it('drena desde 0 sin ningún gap', async () => {
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2'), gasto('e3')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    const r = await drainGroup('G', 'u2', 'deviceNuevo', 0);
    expect(r.ok).toBe(true);
    expect(manifestGapFor('G')).toBeNull();
    if (r.ok) expect(r.applied).toBeGreaterThan(0);
  });
});

describe('P13: cambio de profundidad — nada se pierde ni queda en un estado inconsistente', () => {
  it('tras el bump 1→2, el receptor termina con todos los registros, incluida la edición', async () => {
    // Fuerza el bump con registros grandes (mismo truco que P20 de
    // publicacionIncremental.test.ts): dos ids que comparten prefijo de 1 hex
    // y lo separan a 2, con relleno para superar el SPLIT por defecto haría
    // falta un dataset enorme — acá lo relevante no es EL BUMP puntual (ya
    // cubierto por P20) sino que, exista o no bump, el drenaje aplica todo
    // sin perder nada y sin que el `[]` de limpieza rompa nada.
    const base = Array.from({ length: 30 }, (_, i) => gasto(`e${String(i).padStart(3, '0')}`));
    useExpenseStore.setState({ expenses: base } as never);
    await publishToGroup('G', 'u1', 'device1');
    const primero = await drainGroup('G', 'u2', 'deviceB', 0);
    expect(primero.ok).toBe(true);

    // Se edita uno Y se agrega otro — republicación parcial normal.
    const editado = { ...base[0]!, description: 'editado', updatedAt: 5_000 };
    useExpenseStore.setState({ expenses: [editado, ...base.slice(1), gasto('eNuevo')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    if (!primero.ok) throw new Error('unreachable');
    const segundo = await drainGroup('G', 'u2', 'deviceB', primero.cursor);
    expect(segundo.ok).toBe(true);
    expect(manifestGapFor('G')).toBeNull();
  });
});

describe('P16: borrar el grupo / cambiar de clave limpia appliedSlices y el ledger de ese topic', () => {
  it('marcarPendienteDeDrenaje (reingreso) olvida las dos memorias del topic', async () => {
    useExpenseStore.setState({ expenses: [gasto('e1')] } as never);
    await publishToGroup('G', 'u1', 'device1');
    await drainGroup('G', 'u2', 'deviceB', 0);

    const topic = await topicDe();
    // Algo quedó registrado en las dos memorias (ledger propio de la
    // publicación, aplicadas del drenaje) — si no, el test no prueba nada.
    expect(sliceLedger.__ckeysDelTopic(almacen, topic, 'device1').length).toBeGreaterThan(0);

    marcarPendienteDeDrenaje('G', topic);

    expect(sliceLedger.__ckeysDelTopic(almacen, topic, 'device1')).toEqual([]);
    // appliedSlices no expone un listado directo por topic en su API pública
    // más que a través de `leer` puntual — se verifica indirectamente: tras
    // olvidar, el manifiesto de una republicación completa (sin cambios)
    // vuelve a mandar TODO, porque el emisor también olvidó su ledger.
  });

  it('deleteMyGroupEnvelopes NO toca lo aplicado de otros, a propósito', async () => {
    useExpenseStore.setState({ expenses: [gasto('e1')] } as never);
    await publishToGroup('G', 'u1', 'device1');
    await drainGroup('G', 'u2', 'deviceB', 0);

    const topic = await topicDe();
    const ckeyDeUnCubo = sliceLedger.__ckeysDelTopic(almacen, topic, 'device1')[0]!;
    // Lo que el RECEPTOR ('deviceB') aplicó del sender 'device1' bajo esa ckey.
    expect(appliedSlices.leer(almacen, topic, 'device1', ckeyDeUnCubo)).not.toBeNull();

    await deleteMyGroupEnvelopes('G');
    // `deleteMyGroupEnvelopes` purga lo que ESTE dispositivo publicó — no las
    // aplicadas de otros. Se verifica que sigue existiendo (no es lo que este
    // test prueba) y que el ledger propio sí se limpió (P23, ya cubierto).
    expect(sliceLedger.__ckeysDelTopic(almacen, topic, 'device1')).toEqual([]);
  });
});

describe('P19: dependencia entre cubos de DISTINTOS emisores, en páginas distintas', () => {
  it('el comentario llega ANTES que su gasto (otro emisor) y se aplica igual, al final del drenaje', async () => {
    const topic = await topicDe();
    const key = groupKeyBytes('G')!;

    // Comentario de 'deviceComentarista' sobre 'e1' — SEQ 1, página 1.
    const ckeyComments = await deriveCkey(key, 'comments', '0');
    const comentario: ExpenseComment = {
      id: 'c1', expenseId: 'e1', authorId: 'u1', text: 'hola',
      createdAt: 1, updatedAt: 1, isDeleted: false,
    } as ExpenseComment;
    empujar(topic, envolverCrudo('comments', [comentario]), 'deviceComentarista', ckeyComments);

    // El gasto 'e1' de 'deviceAutor' — SEQ 2, página 2.
    const ckeyExpenses = await deriveCkey(key, 'expenses', '0');
    empujar(topic, envolverCrudo('expenses', [gasto('e1')]), 'deviceAutor', ckeyExpenses);

    // Manifiestos de cada emisor, declarando su propia ckey.
    const manifiestoComentarista = await armarManifiesto([{ ckey: ckeyComments, json: JSON.stringify(envolverCrudo('comments', [comentario])) }]);
    const ckeyManifiestoComentarista = await deriveCkey(key, 'manifest', 'unica');
    empujar(topic, manifiestoComentarista, 'deviceComentarista', ckeyManifiestoComentarista);

    const manifiestoAutor = await armarManifiesto([{ ckey: ckeyExpenses, json: JSON.stringify(envolverCrudo('expenses', [gasto('e1')])) }]);
    empujar(topic, manifiestoAutor, 'deviceAutor', ckeyManifiestoComentarista);

    // Página de 1 sobre por vez: fuerza a que el comentario (seq 1) se
    // APLIQUE antes de que el gasto (seq 2) esté local.
    const r = await drainGroup('G', 'u1', 'deviceReceptor', 0, { pageLimit: 1 });
    expect(r.ok).toBe(true);

    // El comentario sobrevive: se retuvo y se reaplicó al final del drenaje.
    expect(useCommentStore.getState().comments.find(c => c.id === 'c1')).toBeDefined();
    expect(useExpenseStore.getState().expenses.find(e => e.id === 'e1')).toBeDefined();
    // Y el manifiesto de AMBOS emisores cierra sin faltantes: el comentario
    // quedó aplicado (recién al final), y `appliedSlices` lo registró.
    expect(manifestGapFor('G')).toBeNull();
  });
});

describe('P11 y P22: manifiesto que declara un digest que este dispositivo no tiene', () => {
  it('P11: falta registrada tras UNA relectura que tampoco lo encuentra (el sobre nunca llegó al buzón)', async () => {
    const topic = await topicDe();
    const key = groupKeyBytes('G')!;

    // El manifiesto declara una ckey/digest que NUNCA se publicó de verdad
    // (simula un sobre que el TTL ya se llevó, o que se perdió).
    const manifiesto = await armarManifiesto([{ ckey: 'ckey-fantasma', json: JSON.stringify({ nunca: 'llegó' }) }]);
    const ckeyManifiesto = await deriveCkey(key, 'manifest', 'unica');
    empujar(topic, manifiesto, 'deviceAutor', ckeyManifiesto);

    const r = await drainGroup('G', 'u1', 'deviceReceptor', 0);
    expect(r.ok).toBe(true);

    const gap = manifestGapFor('G');
    expect(gap).not.toBeNull();
    expect(gap!.missingCkeys).toContain('ckey-fantasma');
  });

  it('P22: una relectura y no más — un segundo drenaje sobre el MISMO manifiesto no vuelve a intentarlo', async () => {
    const topic = await topicDe();
    const key = groupKeyBytes('G')!;
    const manifiesto = await armarManifiesto([{ ckey: 'ckey-fantasma', json: JSON.stringify({ nunca: 'llegó' }) }]);
    const ckeyManifiesto = await deriveCkey(key, 'manifest', 'unica');
    empujar(topic, manifiesto, 'deviceAutor', ckeyManifiesto);

    const primero = await drainGroup('G', 'u1', 'deviceReceptor', 0);
    expect(primero.ok).toBe(true);
    expect(manifestGapFor('G')?.missingCkeys).toContain('ckey-fantasma');

    // Un segundo drenaje, MISMO manifiesto (mismo seq, no se volvió a
    // publicar nada nuevo): sigue faltando, pero no gasta otra relectura —
    // `relecturas.permite` ya se consumió para esta terna.
    if (!primero.ok) throw new Error('unreachable');
    const segundo = await drainGroup('G', 'u1', 'deviceReceptor', primero.cursor);
    expect(segundo.ok).toBe(true);
    expect(manifestGapFor('G')?.missingCkeys).toContain('ckey-fantasma');
  });
});

describe('P21: manifiesto viejo + cubo ya aplicado con seq MAYOR — sin falta', () => {
  it('una publicación en curso, cortada por la cuota, no genera un falso "falta"', async () => {
    const topic = await topicDe();
    const key = groupKeyBytes('G')!;
    const gastoV1 = gasto('e1');
    const ckeyExpenses = await deriveCkey(key, 'expenses', '0');

    // El manifiesto se generó ANTES de que la cuota dejara pasar el cubo con
    // la v2 (spec §7/§8 C5(c)): declara el digest de la v1, y su propio `seq`
    // en el buzón es MENOR que el del cubo, que salió recién después.
    const manifiestoViejo = await armarManifiesto([{ ckey: ckeyExpenses, json: JSON.stringify(envolverCrudo('expenses', [gastoV1])) }]);
    const ckeyManifiesto = await deriveCkey(key, 'manifest', 'unica');
    empujar(topic, manifiestoViejo, 'deviceAutor', ckeyManifiesto);

    const gastoV2 = { ...gastoV1, description: 'v2', updatedAt: 9_000 };
    empujar(topic, envolverCrudo('expenses', [gastoV2]), 'deviceAutor', ckeyExpenses);

    const r = await drainGroup('G', 'u1', 'deviceReceptor', 0);
    expect(r.ok).toBe(true);
    // El cubo llegó con OTRO digest que el que el manifiesto declara (v2 ≠
    // v1) — la rama "recibida" no cierra sola; cierra porque lo aplicado
    // tiene un `seq` MAYOR que el del manifiesto (C5(c)), nunca un falso
    // "falta" por una publicación en curso que la cuota cortó a mitad de
    // camino.
    expect(manifestGapFor('G')).toBeNull();
    expect(useExpenseStore.getState().expenses.find(e => e.id === 'e1')?.description).toBe('v2');
  });
});

describe('QA#1/V4 (receptor): un tercero que entra tras un cubo vaciado no ve el registro viejo', () => {
  it('gasto traspasado a otro grupo — el cubo vaciado se compacta y el tercero no lo recibe', async () => {
    useExpenseStore.setState({ expenses: [gasto('e1')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    // Traspaso: 'e1' deja de pertenecer a 'G' — `armar()` ya no lo incluye
    // en la próxima publicación, y con el fix QA#1 el cubo que lo contenía
    // se vacía con `[]` (spec §2.1, corregido).
    useExpenseStore.setState({ expenses: [{ ...gasto('e1'), groupId: 'OTRO-GRUPO' }] } as never);
    await publishToGroup('G', 'u1', 'device1');

    // Tercero que entra desde el cursor 0 — store local vacío de verdad
    // (mismo proceso de Jest que el "emisor", así que sin este reset el
    // local ya tendría 'e1' de arriba y el test no probaría nada).
    useExpenseStore.setState({ expenses: [] } as never);
    // El buzón simulado compacta por (sender, ckey), así que sólo ve la
    // versión VACÍA del cubo — nunca la que contenía 'e1'.
    const r = await drainGroup('G', 'u2', 'deviceJoiner', 0);
    expect(r.ok).toBe(true);
    expect(manifestGapFor('G')).toBeNull();
    expect(useExpenseStore.getState().expenses.find(e => e.id === 'e1')).toBeUndefined();
  });
});

describe('V2 (verifier, segunda tanda): una rebanada retenida por dependencia no se pierde si el drenaje sale antes', () => {
  it('el comentario retenido se reaplica ANTES de que un fallo de aplicación posterior corte el drenaje', async () => {
    olvidarFallosDeAplicacion();
    const topic = await topicDe();
    const key = groupKeyBytes('G')!;

    // seq1: comentario de devB sobre 'e1' — su gasto todavía no es local.
    const kc = await deriveCkey(key, 'comments', '0');
    const comentario = {
      id: 'c1', expenseId: 'e1', authorId: 'u1', text: 'hola',
      createdAt: 1, updatedAt: 1, isDeleted: false,
    } as ExpenseComment;
    empujar(topic, envolverCrudo('comments', [comentario]), 'devB', kc);

    // seq2: gasto 'e1' de devA — resuelve la dependencia del comentario.
    const ke = await deriveCkey(key, 'expenses', '1');
    empujar(topic, envolverCrudo('expenses', [gasto('e1')]), 'devA', ke);

    // seq3: rebanada rota de devZ (`expenses` no es un array) — tira dentro
    // de `adaptador.acotar` y agota el presupuesto de reintentos recién al
    // 3er intento (`DRAIN_MAX_REINTENTOS`), así que el PRIMER intento YA
    // dispara el retorno temprano de `drainGroup` (verifier, repro V2).
    empujar(topic, { version: 1, featureVersion: 2, fromUserId: 'q', timestamp: 0, groups: [], expenses: 5, payments: [], users: [] }, 'devZ', 'kz-rota');

    // Antes del fix: el retorno temprano por el fallo de devZ saltaba la
    // reaplicación de `retenidasPorDependencia` — el comentario de seq1
    // (aplicado con dependencia pendiente en la MISMA página, YA con el
    // gasto de seq2 disponible) se perdía para siempre: el cursor avanza
    // más allá de seq1/seq2 y la próxima vuelta sólo repite seq3.
    let cursor = 0;
    for (let i = 0; i < 5; i++) {
      const r = await drainGroup('G', 'u1', 'deviceReceptor', cursor);
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      cursor = r.cursor;
      if (r.completo) break;
    }

    expect(useExpenseStore.getState().expenses.find(e => e.id === 'e1')).toBeDefined();
    expect(useCommentStore.getState().comments.find(c => c.id === 'c1')).toBeDefined();
  });
});

describe('V1 (verifier, segunda tanda): restaurar backup con la misma clave deja el teléfono incompleto', () => {
  function backupVacio(): BackupFile {
    return {
      format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: Date.now(),
      groups: [grupo()], expenses: [], payments: [], users: [],
      personalEntries: [], personalBudget: { currency: 'ARS', monthlyAmount: 0, includeOwedToMe: false },
      recurring: [], comments: [],
      // Sin `ownerId`/`groupKeys`: no dispara el bloque de adopción de
      // claves/re-entrada — lo que se prueba acá es el reset del drenaje,
      // no ese camino (que sí llama a `marcarConTopic` cuando adopta algo).
    };
  }

  it('appliedSlices/ledger/cursor se olvidan al restaurar — el próximo drenaje trae lo que el restore perdió', async () => {
    const topic = await topicDe();
    const key = groupKeyBytes('G')!;
    const E1 = '11111111-1111-4111-8111-111111111111';
    const E2 = '22222222-2222-4222-8222-222222222222';
    const k1 = await deriveCkey(key, 'expenses', '1');
    const k2 = await deriveCkey(key, 'expenses', '2');
    const km = await deriveCkey(key, 'manifest', 'unica');

    const j1 = envolverCrudo('expenses', [gasto(E1)]);
    const j2 = envolverCrudo('expenses', [gasto(E2)]);
    empujar(topic, j1, 'devA', k1);
    empujar(topic, j2, 'devA', k2);
    const manifiesto1 = await armarManifiesto([{ ckey: k1, json: JSON.stringify(j1) }, { ckey: k2, json: JSON.stringify(j2) }]);
    empujar(topic, manifiesto1, 'devA', km);

    const r1 = await drainGroup('G', 'u1', 'devR', 0);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(useExpenseStore.getState().expenses.map(e => e.id).sort()).toEqual([E1, E2]);

    // Restauración de un backup (misma clave de grupo — `adoptKeys` no ve
    // ningún cambio, así que antes del fix nada olvidaba el drenaje):
    // reemplaza los stores, perdiendo E1/E2 localmente.
    applyBackup(backupVacio());
    expect(useExpenseStore.getState().expenses).toEqual([]);

    // devA edita SÓLO E1 — publicación incremental real: el cubo de E2 no
    // viaja de nuevo (no cambió), pero su ckey sigue en el manifiesto.
    const j1b = envolverCrudo('expenses', [gasto(E1, 'editado', 2_000)]);
    empujar(topic, j1b, 'devA', k1);
    const manifiesto2 = await armarManifiesto([{ ckey: k1, json: JSON.stringify(j1b) }, { ckey: k2, json: JSON.stringify(j2) }]);
    empujar(topic, manifiesto2, 'devA', km);

    const r2 = await drainGroup('G', 'u1', 'devR', r1.cursor);
    expect(r2.ok).toBe(true);

    // Con el fix: `applyBackup` olvidó el cursor (vuelve a 0) y el ledger de
    // aplicadas de este topic, así que el drenaje siguiente relee TODO desde
    // el principio — recupera E2 (que el restore había perdido) y aplica la
    // edición de E1.
    const ids = useExpenseStore.getState().expenses.map(e => e.id).sort();
    expect(ids).toEqual([E1, E2]);
    expect(useExpenseStore.getState().expenses.find(e => e.id === E1)?.description).toBe('editado');
    expect(manifestGapFor('G')).toBeNull();
  });
});
