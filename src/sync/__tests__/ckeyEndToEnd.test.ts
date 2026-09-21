/**
 * Acceptance test del plan completo (ADR-007, T-056/T-058): el escenario que
 * de verdad sigue rompiendo la publicación sin partir HOY, contra el tope
 * real (`MAX_PAYLOAD_BYTES = 1_048_576`, 1 MB) documentado en
 * `relay.ts:29-64`.
 *
 * El número viejo (5 miembros, 200 gastos, de ADR-007 el 2026-08-31) quedó
 * desactualizado: `relay.ts` lo mide hoy en 313 KB, sólo **31 %** del tope de
 * 1 MB — ya es seguro SIN rebanar, así que no prueba nada sobre la feature de
 * este plan. La tabla medida con arné real que trae `relay.ts` es:
 *
 * | Grupo                          | En el cable | % del tope |
 * |--------------------------------|-------------|------------|
 * | 5 personas, 30 gastos          |    86 KB    |      8 %   |
 * | 5 personas, 200 gastos (6 m)   |   313 KB    |     31 %   |
 * | 5 personas, 700 gastos         |   982 KB    |     96 %   |
 * | 8 personas, 700 gastos         |  1190 KB    |    116 %   |
 *
 * Este test usa **8 miembros, 700 gastos** — el caso que `relay.ts` mide en
 * 116 % del tope, genuinamente por encima de 1 MB sin partir. Con las
 * rebanadas (Task 2/5), el manifiesto (Task 3/6) y el resto de las piezas de
 * este plan (Tasks 1-9) ya integradas en `relaySync.ts`, tiene que:
 *
 *  1. Publicar sin `too_large` (a pesar de que el JSON sin partir excede el
 *     tope, según la medición de `relay.ts`).
 *  2. Dejar que un miembro que entra tarde (store vacío, cursor 0) reconstruya
 *     el historial completo, sin gaps de manifiesto (P-2, ADR-007 §4 fila 4).
 *
 * A diferencia de los fixtures de Tasks 5/6 (`gasto()` con un solo `split`),
 * acá cada gasto lleva `splits` real de los 8 miembros — es lo que reproduce
 * el peso por gasto representativo del escenario de 8 personas / 700 gastos
 * que `relay.ts` documenta como genuinamente sobre el tope sin rebanar.
 */

jest.mock('../relay', () => {
  // Revisión final, Fix 5: el mock original aceptaba CUALQUIER payload sin
  // mirar su tamaño, así que `expect(result.ok).toBe(true)` pasaba igual de
  // "bien" con el slicing roto o directamente sacado — no probaba nada sobre
  // el tope real. Acá se reusa el `byteLength`/`MAX_PAYLOAD_BYTES` REALES de
  // `relay.ts` (vía `jest.requireActual`, no una copia local que se puede
  // desalinear) para que `sendEnvelope` rechace de verdad cualquier sobre que
  // exceda el tope — igual que el servidor real.
  const real = jest.requireActual('../relay') as {
    byteLength: (s: string) => number;
    MAX_PAYLOAD_BYTES: number;
  };
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string }[]>();
  let seq = 0;
  return {
    ...real,
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false, ckey?: string) => {
      if (real.byteLength(payload) > real.MAX_PAYLOAD_BYTES) {
        return { ok: false, reason: 'too_large' as const };
      }
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
import { byteLength, MAX_PAYLOAD_BYTES } from '../relay';
import type { Group, Expense } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as {
  __buzones: Map<string, { ckey?: string; compactable?: boolean; payload: string }[]>;
  __reset: () => void;
};

const MIEMBROS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'];

function grupo(): Group {
  return {
    id: 'G', name: 'Grupo', memberIds: MIEMBROS, currency: 'USD',
    createdAt: 1, createdById: 'u1', deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Group;
}

/**
 * Gasto con `splits` real de los 8 miembros del grupo (no 1, como en los
 * fixtures de Tasks 5/6) — es lo que reproduce el peso por gasto del
 * escenario de 8 personas / 700 gastos que `relay.ts` mide en 116 % del
 * tope sin partir.
 */
function gastoDeOchoMiembros(id: string, miembros: string[]): Expense {
  const monto = 100;
  const porCabeza = monto / miembros.length;
  return {
    id,
    groupId: 'G',
    description: `Gasto compartido ${id} `.repeat(10),
    amount: monto,
    currency: 'USD',
    paidById: miembros[0],
    splits: miembros.map(userId => ({ userId, amount: porCabeza, isPaid: false })),
    splitMode: 'equal',
    category: 'other',
    date: 1,
    createdAt: 1,
    createdById: miembros[0],
    deletionVotes: [],
    updatedAt: 1_000,
    isDeleted: false,
  } as Expense;
}

describe('escenario T-056/T-058: 8 miembros, 700 gastos (116% del tope sin partir, per relay.ts)', () => {
  beforeEach(() => {
    relayMock.__reset();
    clearManifestGaps();
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().ensureKey('G');
  });

  it('publica sin too_large donde antes fallaba', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    const gastos = Array.from({ length: 700 }, (_, i) => gastoDeOchoMiembros(`e${i}`, MIEMBROS));
    useExpenseStore.setState({ expenses: gastos } as never);

    const result = await publishToGroup('G', 'u1', 'device1');
    expect(result.ok).toBe(true);

    // Fix 5: no basta con que el publish haya vuelto `ok: true` — con el mock
    // ahora rechazando de verdad cualquier sobre sobre el tope real, esta
    // aserción es una prueba genuina de que CADA sobre individual quedó bajo
    // `MAX_PAYLOAD_BYTES`, no sólo que el resultado agregado "pasó".
    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)!;
    expect(sobres.length).toBeGreaterThan(0);
    for (const sobre of sobres) {
      expect(byteLength(sobre.payload)).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    }
  });

  it('el que entra tarde reconstruye el historial completo (P-2)', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    const gastos = Array.from({ length: 700 }, (_, i) => gastoDeOchoMiembros(`e${i}`, MIEMBROS));
    useExpenseStore.setState({ expenses: gastos } as never);
    await publishToGroup('G', 'u1', 'device1');

    // "u9" entra tarde: store vacío, drena desde 0.
    useExpenseStore.setState({ expenses: [] } as never);
    const drenaje = await drainGroup('G', 'u9', 'device2', 0);

    expect(drenaje.ok).toBe(true);
    expect(useExpenseStore.getState().expenses).toHaveLength(700);
    expect(manifestGapFor('G')).toBeNull();
  });
});
