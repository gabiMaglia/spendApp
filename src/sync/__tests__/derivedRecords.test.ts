import { derivedOriginOf } from '../derivedRecords';
import { EXPENSE, PAYMENT, COMMENT, GROUP, RECURRING } from '@/src/test-utils/recordFixtures';

/**
 * D4 del PO: los registros que **nadie puede firmar por diseño** tienen su
 * propia categoría, no se cuentan como `no_verificable` ni se descartan en
 * silencio.
 *
 * Son dos clases, y las dos las crea un device que NO es el autor:
 *  - los `Payment` de `applyApprovedLeaves` (`createdById` es el que se va);
 *  - los `Expense` de `materializeRecurring` (los emite cualquiera al arrancar).
 *
 * **"No tiene firma" no alcanza para detectarlos**: un registro anterior a
 * T-041 tampoco la tiene y ése SÍ es `no_verificable`. Lo que los distingue es
 * su **forma**: los dos tienen id derivado y determinista, y los dos deben
 * cerrar contra los campos que ese id promete.
 */

const pagoDeSalida = () => ({
  ...PAYMENT,
  id: 'leave:g-1:beto:4500:0',
  groupId: 'g-1',
  createdById: 'beto',
});

const gastoMaterializado = () => ({
  ...EXPENSE,
  id: 'rec_r-1_1700000000000',
  date: 1_700_000_000_000,
  createdAt: 1_700_000_000_000,
});

describe('pago de absorción de deuda (`applyLeave`)', () => {
  it('lo reconoce por su id derivado', () => {
    expect(derivedOriginOf('payment', pagoDeSalida())).toBe('leave');
  });

  /**
   * El id NO es una etiqueta que uno se pone solo: promete `groupId` y
   * `createdById`. Sin este cierre, cualquiera esconde un pago ajeno en la
   * cuarta categoría poniéndole el prefijo, y el número que D4 existe para
   * mirar deja de significar algo.
   */
  it('un id que promete otro grupo no cuela', () => {
    expect(derivedOriginOf('payment', { ...pagoDeSalida(), groupId: 'otro' })).toBeNull();
  });

  it('un id que promete otro autor no cuela', () => {
    expect(derivedOriginOf('payment', { ...pagoDeSalida(), createdById: 'ana' })).toBeNull();
  });

  it('un id con partes de más o de menos no cuela', () => {
    expect(derivedOriginOf('payment', { ...pagoDeSalida(), id: 'leave:g-1:beto:4500' })).toBeNull();
    expect(derivedOriginOf('payment', { ...pagoDeSalida(), id: 'leave:g-1:beto:4500:0:x' })).toBeNull();
  });

  it('el `requestedAt` y el índice tienen que ser números', () => {
    expect(derivedOriginOf('payment', { ...pagoDeSalida(), id: 'leave:g-1:beto:ayer:0' })).toBeNull();
    expect(derivedOriginOf('payment', { ...pagoDeSalida(), id: 'leave:g-1:beto:4500:x' })).toBeNull();
  });

  it('un gasto no es un pago de salida aunque le pongan el id', () => {
    expect(derivedOriginOf('expense', { ...EXPENSE, id: 'leave:g-1:ana:4500:0' })).toBeNull();
  });
});

describe('gasto materializado desde una plantilla recurrente', () => {
  it('lo reconoce por su id derivado', () => {
    expect(derivedOriginOf('expense', gastoMaterializado())).toBe('recurring');
  });

  /**
   * `materializeRecurring` ancla `date` y `createdAt` al VENCIMIENTO que va
   * adentro del id. Es el cierre que hace que el prefijo no sea gratis.
   */
  it('un id cuyo vencimiento no coincide con la fecha del gasto no cuela', () => {
    expect(derivedOriginOf('expense', { ...gastoMaterializado(), date: 1 })).toBeNull();
    expect(derivedOriginOf('expense', { ...gastoMaterializado(), createdAt: 1 })).toBeNull();
  });

  it('el vencimiento tiene que ser un número', () => {
    expect(derivedOriginOf('expense', { ...gastoMaterializado(), id: 'rec_r-1_marzo' })).toBeNull();
  });

  it('una plantilla con guiones bajos en su id sigue funcionando', () => {
    const r = {
      ...EXPENSE,
      id: 'rec_plantilla_con_guiones_1700000000000',
      date: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    };
    expect(derivedOriginOf('expense', r)).toBe('recurring');
  });
});

describe('todo lo demás no es derivado', () => {
  it('un gasto normal, un pago normal, un comentario, un grupo y una plantilla', () => {
    expect(derivedOriginOf('expense', EXPENSE)).toBeNull();
    expect(derivedOriginOf('payment', PAYMENT)).toBeNull();
    expect(derivedOriginOf('comment', COMMENT)).toBeNull();
    expect(derivedOriginOf('group', GROUP)).toBeNull();
    expect(derivedOriginOf('recurring', RECURRING)).toBeNull();
  });

  it('un registro sin id no es derivado', () => {
    expect(derivedOriginOf('payment', { ...PAYMENT, id: '' })).toBeNull();
  });
});
