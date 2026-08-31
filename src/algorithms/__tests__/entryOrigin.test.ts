import { originOf, isEditable, reasonKey } from '../entryOrigin';

describe('origen de un movimiento personal', () => {
  it('un gasto cargado a mano es manual y editable', () => {
    expect(originOf({ kind: 'expense' })).toBe('manual');
    expect(isEditable({ kind: 'expense' })).toBe(true);
  });

  it('un ingreso cargado a mano tambien', () => {
    expect(isEditable({ kind: 'income' })).toBe(true);
  });

  it('la replica de un gasto de grupo es derivada y NO editable', () => {
    // Editarla la desincronizaria del gasto que la origino, sin forma de
    // reconciliarlos.
    expect(originOf({ kind: 'group_replicated' })).toBe('derived');
    expect(isEditable({ kind: 'group_replicated' })).toBe(false);
  });

  it('el arrastre de mes tampoco es editable', () => {
    expect(isEditable({ kind: 'carryover' })).toBe(false);
  });

  it('una clase NUEVA se trata como manual, no como derivada', () => {
    // Elegido a proposito: tratar lo desconocido como derivado dejaria al
    // usuario sin poder tocar un movimiento suyo y sin ninguna pista de por que.
    expect(isEditable({ kind: 'algo_que_no_existe_todavia' as never })).toBe(true);
  });
});

describe('por que no se puede editar', () => {
  it('lo editable no tiene motivo', () => {
    expect(reasonKey({ kind: 'expense' })).toBeNull();
  });

  it('la replica de grupo dice que viene de un grupo', () => {
    expect(reasonKey({ kind: 'group_replicated' })).toBe('personal.locked_from_group');
  });

  it('el resto de lo derivado tiene su propio motivo', () => {
    expect(reasonKey({ kind: 'carryover' })).toBe('personal.locked_derived');
  });
});
