import {
  comentariosDelGasto, netoParaMi, permisosDeGasto,
} from '@/src/screens/expenseDetail/permisosDeGasto';
import type { ExpenseComment } from '@/src/types/models';

/**
 * T-223: lógica pura que vivía dentro de `app/expense/[id].tsx`.
 * Estos tests fijan el comportamiento de antes de la mudanza.
 */

const base = {
  hayUsuario: true, isCreator: false, isDeleted: false,
  grupoResuelto: true, esMiembroDelGrupo: true,
};

describe('permisosDeGasto', () => {
  it('un miembro del grupo edita y borra al instante (T-186)', () => {
    expect(permisosDeGasto(base)).toEqual({ borradoDirecto: true, puedeEditar: true });
  });

  it('quien no es miembro de un grupo resuelto no edita ni borra, aunque sea el creador para borrar', () => {
    expect(permisosDeGasto({ ...base, esMiembroDelGrupo: false }))
      .toEqual({ borradoDirecto: false, puedeEditar: false });
    // El creador edita siempre; el borrado directo lo decide la membresía.
    expect(permisosDeGasto({ ...base, esMiembroDelGrupo: false, isCreator: true }))
      .toEqual({ borradoDirecto: false, puedeEditar: true });
  });

  it('grupo sin resolver: cae a «el creador manda», no al más restrictivo', () => {
    const sinGrupo = { ...base, grupoResuelto: false, esMiembroDelGrupo: false };
    expect(permisosDeGasto({ ...sinGrupo, isCreator: true }))
      .toEqual({ borradoDirecto: true, puedeEditar: true });
    expect(permisosDeGasto(sinGrupo)).toEqual({ borradoDirecto: false, puedeEditar: false });
  });

  it('sin usuario no hay borrado directo', () => {
    expect(permisosDeGasto({ ...base, hayUsuario: false }).borradoDirecto).toBe(false);
  });

  it('un gasto borrado no se edita', () => {
    expect(permisosDeGasto({ ...base, isDeleted: true, isCreator: true }).puedeEditar).toBe(false);
  });
});

describe('netoParaMi', () => {
  it('si pagué, el neto es lo que puse menos mi parte', () => {
    expect(netoParaMi({ amount: 1000, myShare: 250, isPayer: true })).toBe(750);
  });

  it('si no pagué, debo mi parte', () => {
    expect(netoParaMi({ amount: 1000, myShare: 250, isPayer: false })).toBe(-250);
  });

  it('sin parte ni pago, neto cero', () => {
    expect(netoParaMi({ amount: 1000, myShare: 0, isPayer: false })).toBe(-0);
  });
});

describe('comentariosDelGasto', () => {
  const cm = (id: string, expenseId: string, createdAt: number, isDeleted = false) =>
    ({ id, expenseId, authorId: 'u', text: id, createdAt, updatedAt: createdAt, isDeleted }) as ExpenseComment;

  it('filtra por gasto, saca los borrados y ordena por creación', () => {
    const todos = [cm('c3', 'e1', 30), cm('c1', 'e1', 10), cm('x', 'e2', 5), cm('c2', 'e1', 20, true)];
    expect(comentariosDelGasto(todos, 'e1').map(c => c.id)).toEqual(['c1', 'c3']);
  });

  it('lista vacía o id ausente da vacío', () => {
    expect(comentariosDelGasto([], 'e1')).toEqual([]);
    expect(comentariosDelGasto([cm('c1', 'e1', 1)], undefined)).toEqual([]);
  });
});
