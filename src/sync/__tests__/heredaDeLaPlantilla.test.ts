import { ed25519 } from '@noble/curves/ed25519.js';
import { checkRecord } from '../trustCheck';
import { signCore } from '../recordSign';
import { toHex } from '../hexBytes';
import { clearVerdictCache } from '../verdictCache';
import { forgetAuthorKeys, reloadAuthorKeys, rememberAuthorKey, __resetAuthorSources } from '../authorKeys';
import { buildSplits } from '@/src/algorithms/buildSplits';
import type { Expense, RecurringExpense } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('./../deviceKeys', () => ({ fetchAccountKeys: jest.fn(async () => []) }));
jest.mock('./../contactChannel', () => ({ getPeer: () => undefined }));

const PRIV = 'a'.repeat(64);
const PUB  = toHex(ed25519.getPublicKey(Buffer.from(PRIV, 'hex')));
const VENC = 1_800_000_000_000;

const base = (): RecurringExpense => ({
  id: 'tpl-1', groupId: 'g1', description: 'Alquiler', amount: 500_000,
  currency: 'ARS', paidById: 'ana', splitMode: 'equal',
  memberIds: ['ana', 'beto'], category: 'home',
  createdById: 'ana', isActive: true, lastMaterializedAt: 0,
  rule: { frequency: 'monthly', anchor: VENC },
  rev: 1, createdAt: 0, updatedAt: 0, isDeleted: false,
} as unknown as RecurringExpense);

/** La plantilla, firmada por Ana. */
function plantillaFirmada(over: Partial<RecurringExpense> = {}): RecurringExpense {
  const t = { ...base(), ...over };
  return { ...t, ...signCore('recurring', t, PRIV) };
}

/** El gasto que `materializeRecurring` produce: SIN firma, y no puede tenerla. */
const materializado = (t: RecurringExpense, at = VENC): Expense => ({
  id: `rec_${t.id}_${at}`,
  groupId: t.groupId, description: t.description, amount: t.amount,
  currency: t.currency, paidById: t.paidById, splitMode: t.splitMode,
  splits: buildSplits(t.amount, t.memberIds, t.splitMode, t.splitValues),
  category: t.category, date: at, createdAt: at, createdById: t.createdById,
  deletionVotes: [], updatedAt: at, isDeleted: false,
} as Expense);

beforeEach(() => {
  __resetAuthorSources();
  forgetAuthorKeys();
  reloadAuthorKeys();
  clearVerdictCache();
  rememberAuthorKey('ana', PUB);
});

/**
 * **El hueco D5, cerrado** (T-041 · S9).
 *
 * Un gasto materializado desde una plantilla recurrente no lo firmó nadie, y
 * nadie podía: lo emite el primer device que abre la app después del
 * vencimiento, y firmarlo sería declarar autoría ajena. Caía en la cuarta
 * categoría de D4 —`no_firmable`— y ese contador no bajaba nunca.
 *
 * La salida no es un campo nuevo que viaje —el sobre ya está contra el techo
 * (T-058)— sino recalcular: el gasto deriva ENTERO de la plantilla, así que si
 * le es fiel y la firma de la plantilla cierra, es tan atribuible como ella.
 */
describe('un gasto materializado hereda el veredicto de su plantilla', () => {
  const buscar = (t: RecurringExpense) => (id: string) => (id === t.id ? t : undefined);

  it('con la plantilla firmada y el gasto fiel: VÁLIDA, no no_firmable', () => {
    const t = plantillaFirmada();
    expect(checkRecord('expense', materializado(t), buscar(t))).toBe('valida');
  });

  it('sin el buscador sigue siendo no_firmable: es lo que había antes', () => {
    const t = plantillaFirmada();
    expect(checkRecord('expense', materializado(t))).toBe('no_firmable');
  });

  /**
   * **El vector.** Un atacante toma un gasto derivado legítimo, le cambia el
   * monto, y lo republica. Si heredara igual, la plantilla firmada de Ana
   * estaría avalando un número que Ana nunca puso.
   */
  it('un gasto derivado con el monto cambiado NO hereda', () => {
    const t = plantillaFirmada();
    const falso = { ...materializado(t), amount: 9_999_900 };
    expect(checkRecord('expense', falso, buscar(t))).toBe('no_firmable');
  });

  it('si la firma de la plantilla no cierra, el gasto tampoco hereda validez', () => {
    const t = plantillaFirmada();
    const rota = { ...t, amount: t.amount + 1 };   // firma vieja, núcleo nuevo
    // El gasto es fiel a la plantilla ROTA, así que hereda su veredicto: inválida.
    expect(checkRecord('expense', materializado(rota), buscar(rota))).toBe('invalida');
  });

  /**
   * Que falte la plantilla es falta de información —el caso normal de quien
   * entró al grupo después—, no una acusación. Cae en la clasificación de
   * siempre, no en `invalida`.
   */
  it('sin la plantilla a mano, no se acusa a nadie', () => {
    const t = plantillaFirmada();
    expect(checkRecord('expense', materializado(t), () => undefined)).toBe('no_firmable');
  });

  it('un gasto normal sin firma sigue siendo no_verificable, no no_firmable', () => {
    const t = plantillaFirmada();
    const normal = { ...materializado(t), id: 'uuid-comun-9f8a' };
    expect(checkRecord('expense', normal, buscar(t))).toBe('no_verificable');
  });
});
