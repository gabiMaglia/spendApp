import { motivoDeBloqueo } from '../bloqueoDeEntrada';

const ahora = new Date(2026, 10, 15, 12);
const esteMes = new Date(2026, 10, 2).getTime();
const mesPasado = new Date(2026, 9, 28).getTime();

describe('motivoDeBloqueo (T-259)', () => {
  it('una manual del mes corriente se puede tocar', () => {
    expect(motivoDeBloqueo({ kind: 'expense', date: esteMes }, ahora)).toBeNull();
    expect(motivoDeBloqueo({ kind: 'income', date: esteMes }, ahora)).toBeNull();
  });

  it('una manual de un mes cerrado no', () => {
    expect(motivoDeBloqueo({ kind: 'expense', date: mesPasado }, ahora)).toBe('personal.locked_closed_month');
  });

  it('una derivada dice su origen, sea del mes que sea', () => {
    expect(motivoDeBloqueo({ kind: 'group_replicated', date: esteMes }, ahora)).toBe('personal.locked_from_group');
    expect(motivoDeBloqueo({ kind: 'carryover', date: mesPasado }, ahora)).toBe('personal.locked_derived');
  });
});
