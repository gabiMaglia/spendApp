import { ed25519 } from '@noble/curves/ed25519.js';
import { mergeRecord, mergeByIdLevels } from '../mergeLevels';
import { toHex } from '@/src/sync/nucleo/hexBytes';
import { signCore } from '@/src/sync/confianza/recordSign';
import { rememberAuthorKey, forgetAuthorKeys } from '@/src/sync/confianza/authorKeys';
import * as errorLog from '@/src/services/errorLog';
import { useExpenseStore } from '../expenseStore';
import type { Expense, NucleoDisputado } from '@/src/types/models';

jest.mock('@/src/sync/motor/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

/**
 * T-170 · D-2. El literal del backlog («autor distinto → el entrante no gana») no
 * converge (§2 del plan). Lo único convergente adentro del merge es REGISTRAR la
 * disputa; el poder de creador (y si la disputa es ATRIBUIBLE de verdad) se
 * decide afuera (`src/sync/autoriaTrust.ts`, `src/sync/forcedTrust.ts`).
 *
 * **Ronda 2 (dictamen del verificador):** lo que se une ya no es un `createdById`
 * suelto — es el NÚCLEO COMPETIDOR completo, con su firma. Acá se prueba sólo
 * la UNIÓN estructural (D9: el merge nunca verifica una firma), con hex que
 * TIENE FORMA de clave/firma pero no necesariamente verifica de verdad — eso
 * es lo que prueba `src/sync/__tests__/autoriaTrust.test.ts` con crypto real.
 */
const NOW = 1_800_000_000_000;
const deAna = {
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 10_000, currency: 'ARS', paidById: 'ana',
  createdById: 'ana', splits: [], splitMode: 'equal', category: 'food', date: NOW - 10_000,
  createdAt: NOW - 10_000, updatedAt: NOW - 10_000, isDeleted: false, rev: NOW - 10_000, k: 'aa'.repeat(32), s: 'bb'.repeat(64),
} as unknown as Expense;
const deMallory = { ...deAna, createdById: 'mallory', amount: 1, rev: NOW - 9_000,
  updatedAt: NOW - 9_000, k: 'cc'.repeat(32), s: 'dd'.repeat(64) } as Expense;
const deCarla = { ...deAna, createdById: 'carla', amount: 2, rev: NOW - 8_000,
  updatedAt: NOW - 8_000, k: 'ee'.repeat(32), s: 'ff'.repeat(64) } as Expense;

const aplicar = (orden: Expense[]): Expense =>
  orden.slice(1).reduce((acc, r) => mergeByIdLevels('expense', acc, [r], NOW), [orden[0]!])[0]!;

const autoresDe = (e: Expense): string[] =>
  (e.autoriaDisputada ?? []).map(n => n.createdById).slice().sort();

describe('D-2 · la autoría se disputa, no se gana (unión estructural del merge)', () => {
  it('T-170.1: autor distinto, los dos con firma → los dos órdenes convergen capturando los dos núcleos', () => {
    const a = mergeRecord('expense', deAna, deMallory, NOW);
    const b = mergeRecord('expense', deMallory, deAna, NOW);
    expect(a).toEqual(b);
    expect(autoresDe(a)).toEqual(['ana', 'mallory']);
    expect(a.amount).toBe(1);      // el núcleo sigue por `rev`: R4, aceptado por el PO
    // Cada entrada preserva la firma REAL de ese lado, no una mezcla.
    expect(a.autoriaDisputada!.find(n => n.createdById === 'mallory')!.s).toBe('dd'.repeat(64));
    expect(a.autoriaDisputada!.find(n => n.createdById === 'ana')!.s).toBe('bb'.repeat(64));
  });

  it('I-2: tres autores, las seis permutaciones dan el mismo registro', () => {
    const perms: Expense[][] = [
      [deAna, deMallory, deCarla], [deAna, deCarla, deMallory], [deMallory, deAna, deCarla],
      [deMallory, deCarla, deAna], [deCarla, deAna, deMallory], [deCarla, deMallory, deAna],
    ];
    const salidas = perms.map(aplicar);
    for (const s of salidas) expect(s).toEqual(salidas[0]);
    expect(autoresDe(salidas[0]!)).toEqual(['ana', 'carla', 'mallory']);
  });

  it('T-170.2: edición del propio autor con rev+1 gana como hoy y no abre disputa', () => {
    const editado = { ...deAna, amount: 12_000, rev: (deAna.rev as number) + 1, s: '11'.repeat(64) } as Expense;
    const out = mergeRecord('expense', deAna, editado, NOW);
    expect(out.amount).toBe(12_000);
    expect(out.autoriaDisputada).toBeUndefined();
  });

  it('ronda 1 (ya cerrada): un `string[]` inyectado sin forma de núcleo no tiene efecto — no hay firma que preservar', () => {
    const inyectado = { ...deAna, autoriaDisputada: ['ana', 'zed'] } as unknown as Expense;
    const out = mergeRecord('expense', deAna, inyectado, NOW);
    expect(out.amount).toBe(10_000);
    expect(out.createdById).toBe('ana');
    expect((out as { s?: string }).s).toBe((deAna as { s?: string }).s);
    expect(out.autoriaDisputada).toBeUndefined();
  });

  it('sin cambios devuelve la MISMA referencia', () => {
    const disputado = mergeRecord('expense', deAna, deMallory, NOW);
    expect(mergeRecord('expense', disputado, deMallory, NOW)).toBe(disputado);
  });

  it('la disputa se une por CONTENIDO (no LWW): dos núcleos firmados distintos conviven', () => {
    const entradaAna: NucleoDisputado = {
      id: 'e1', groupId: 'g1', description: 'Cena', amount: 10_000, currency: 'ARS',
      paidById: 'ana', splits: [], splitMode: 'equal', category: 'food', date: NOW - 10_000,
      createdAt: NOW - 10_000, createdById: 'ana', rev: NOW - 10_000,
      k: 'aa'.repeat(32), s: 'bb'.repeat(64),
    };
    const entradaYyy: NucleoDisputado = { ...entradaAna, createdById: 'yyy', k: '11'.repeat(32), s: '22'.repeat(64) };
    const entradaZzz: NucleoDisputado = { ...entradaAna, createdById: 'zzz', k: '33'.repeat(32), s: '44'.repeat(64) };
    const conY = { ...deAna, autoriaDisputada: [entradaAna, entradaYyy] } as Expense;
    const conZ = { ...deAna, autoriaDisputada: [entradaAna, entradaZzz] } as Expense;
    expect(autoresDe(mergeRecord('expense', conY, conZ, NOW))).toEqual(['ana', 'yyy', 'zzz']);
  });
});

const PRIV_ANA = toHex(new Uint8Array(32).fill(5));
const PUB_ANA = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(5)));
const PRIV_MALLORY = toHex(new Uint8Array(32).fill(6));
const PUB_MALLORY = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(6)));

const anaSinFirmar = {
  id: 'e2', groupId: 'g1', description: 'Cena', amount: 10_000, currency: 'ARS', paidById: 'ana',
  createdById: 'ana', splits: [], splitMode: 'equal', category: 'food', date: NOW - 10_000,
  createdAt: NOW - 10_000, updatedAt: NOW - 10_000, isDeleted: false, rev: NOW - 10_000,
} as unknown as Expense;
const anaFirmada = { ...anaSinFirmar, ...signCore('expense', anaSinFirmar as never, PRIV_ANA) } as Expense;
const malloryFirmada = {
  ...anaSinFirmar, createdById: 'mallory', amount: 1, rev: NOW - 9_000, updatedAt: NOW - 9_000,
} as Expense;
const malloryFirmadaConFirma =
  { ...malloryFirmada, ...signCore('expense', malloryFirmada as never, PRIV_MALLORY) } as Expense;

describe('P-1: rastro de diagnóstico — SÓLO cuando la disputa es ATRIBUIBLE (firma real, T-170 D-3)', () => {
  afterEach(() => { jest.restoreAllMocks(); forgetAuthorKeys(); });

  it('con las dos claves conocidas: rastro sync.autoria_disputada, una sola vez', () => {
    rememberAuthorKey('ana', PUB_ANA);
    rememberAuthorKey('mallory', PUB_MALLORY);
    const espia = jest.spyOn(errorLog, 'recordError');
    useExpenseStore.setState({ expenses: [anaFirmada] });
    useExpenseStore.getState().mergeExpenses([malloryFirmadaConFirma], NOW);
    useExpenseStore.getState().mergeExpenses([malloryFirmadaConFirma], NOW);
    const rastros = espia.mock.calls.filter(([e]) => e.message.startsWith('sync.autoria_disputada'));
    expect(rastros).toHaveLength(1);
    expect(rastros[0]![0].message).toBe('sync.autoria_disputada id=e2');
  });

  it('sin ninguna clave conocida: el merge registra el reclamo, pero no es atribuible — sin rastro', () => {
    const espia = jest.spyOn(errorLog, 'recordError');
    useExpenseStore.setState({ expenses: [anaFirmada] });
    useExpenseStore.getState().mergeExpenses([malloryFirmadaConFirma], NOW);
    const rastros = espia.mock.calls.filter(([e]) => e.message.startsWith('sync.autoria_disputada'));
    expect(rastros).toHaveLength(0);
    // El reclamo SÍ quedó guardado (unión estructural, D9): sólo falta la clave.
    expect(useExpenseStore.getState().expenses[0]!.autoriaDisputada).toHaveLength(2);
  });
});
