import { origenRecurrenteDe, fielALaPlantilla } from '../derivedRecurring';
import { buildSplits } from '../buildSplits';
import type { Expense, RecurringExpense } from '@/src/types/models';

const VENC = 1_800_000_000_000;

const plantilla = (over: Partial<RecurringExpense> = {}): RecurringExpense => ({
  id: 'tpl-1', groupId: 'g1', description: 'Alquiler', amount: 5_000_00,
  currency: 'ARS', paidById: 'ana', splitMode: 'equal',
  memberIds: ['ana', 'beto'], category: 'home',
  createdById: 'ana', isActive: true, lastMaterializedAt: 0,
  rule: { frequency: 'monthly', anchor: VENC },
  createdAt: 0, updatedAt: 0, isDeleted: false, ...over,
} as RecurringExpense);

/** Lo que `materializeRecurring` produce a partir de esa plantilla. */
const materializado = (t = plantilla(), at = VENC, over: Partial<Expense> = {}): Expense => ({
  id: `rec_${t.id}_${at}`,
  groupId: t.groupId, description: t.description, amount: t.amount,
  currency: t.currency, paidById: t.paidById, splitMode: t.splitMode,
  splits: buildSplits(t.amount, t.memberIds, t.splitMode, t.splitValues),
  category: t.category, date: at, createdAt: at, createdById: t.createdById,
  deletionVotes: [], updatedAt: at, isDeleted: false, ...over,
} as Expense);

describe('de qué plantilla dice venir', () => {
  it('lee la plantilla y el vencimiento', () => {
    expect(origenRecurrenteDe(`rec_tpl-1_${VENC}`))
      .toEqual({ templateId: 'tpl-1', vencimiento: VENC });
  });

  // El id de la plantilla puede tener guiones bajos; el vencimiento nunca.
  it('corta por el ÚLTIMO guión bajo', () => {
    expect(origenRecurrenteDe('rec_mi_plantilla_rara_999'))
      .toEqual({ templateId: 'mi_plantilla_rara', vencimiento: 999 });
  });

  it('un gasto normal no tiene origen recurrente', () => {
    expect(origenRecurrenteDe('9f8a-uuid-cualquiera')).toBeNull();
  });

  it.each(['rec_', 'rec_tpl', 'rec_tpl_', 'rec_tpl_no-es-numero', 'rec__123'])(
    'un id mal formado (%s) no se acepta', id => {
      expect(origenRecurrenteDe(id)).toBeNull();
    });
});

describe('¿el gasto es fiel a su plantilla?', () => {
  it('el materializado tal cual: sí', () => {
    expect(fielALaPlantilla(materializado(), plantilla(), VENC)).toBe(true);
  });

  /**
   * **Los vectores que hacen que esto sirva de algo.** Si cualquiera de estos
   * pasara, un atacante tomaría un gasto derivado legítimo, le cambiaría lo que
   * quisiera, y seguiría heredando la firma de la plantilla.
   */
  const cambios: [string, Partial<Expense>][] = [
    ['el monto',        { amount: 9_999_00 }],
    ['la descripción',  { description: 'Otra cosa' }],
    ['quién pagó',      { paidById: 'beto' }],
    ['la moneda',       { currency: 'USD' as const }],
    ['el grupo',        { groupId: 'otro' }],
    ['el autor',        { createdById: 'caro' }],
    ['la categoría',    { category: 'food' as const }],
    ['el modo de división', { splitMode: 'custom' as const }],
    ['la fecha',        { date: VENC + 1 }],
    ['el createdAt',    { createdAt: VENC + 1 }],
  ];

  it.each(cambios)('cambiarle %s lo vuelve infiel', (_, cambio) => {
    expect(fielALaPlantilla(materializado(plantilla(), VENC, cambio), plantilla(), VENC))
      .toBe(false);
  });

  // `splits` se recalcula, no se compara crudo: cambiar el reparto sin tocar
  // el monto es justo lo que pasaría inadvertido si sólo se mirara `amount`.
  it('repartir distinto sin tocar el monto también lo vuelve infiel', () => {
    const torcido = materializado(plantilla(), VENC, {
      splits: [
        { userId: 'ana', amount: 1, isPaid: false },
        { userId: 'beto', amount: 5_000_00 - 1, isPaid: false },
      ],
    });
    expect(fielALaPlantilla(torcido, plantilla(), VENC)).toBe(false);
  });

  it('sacarle un participante al reparto tampoco pasa', () => {
    const torcido = materializado(plantilla(), VENC, {
      splits: [{ userId: 'ana', amount: 5_000_00, isPaid: false }],
    });
    expect(fielALaPlantilla(torcido, plantilla(), VENC)).toBe(false);
  });

  it('un gasto de OTRA plantilla no es fiel a ésta', () => {
    expect(fielALaPlantilla(materializado(), plantilla({ id: 'tpl-2' }), VENC)).toBe(false);
  });

  /**
   * Lo que un tercero escribe —borrarlo, votar su borrado, tocar `updatedAt`—
   * NO lo vuelve infiel: sigue siendo el mismo gasto derivado. Comparar el
   * registro entero con un `canonical()` habría roto esto.
   */
  it('borrarlo o votarlo NO lo vuelve infiel', () => {
    const tocado = materializado(plantilla(), VENC, {
      isDeleted: true, updatedAt: VENC + 999_999,
      deletionVotes: [{ userId: 'beto', votedAt: 1, action: 'delete' }],
    });
    expect(fielALaPlantilla(tocado, plantilla(), VENC)).toBe(true);
  });

  // Una plantilla personal produce `PersonalEntry`, no `Expense`.
  it('una plantilla personal no atribuye gastos de grupo', () => {
    expect(fielALaPlantilla(materializado(), plantilla({ groupId: '' }), VENC)).toBe(false);
  });
});
