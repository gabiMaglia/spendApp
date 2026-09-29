import type { ExpenseComment } from '@/src/types/models';

/**
 * Quién puede editar y borrar un gasto. Cualquier miembro del grupo edita y
 * borra al instante, igual que Splitwise (T-186: se sacó el modo «con
 * acuerdo», ver docs/CONSENSO-PENDIENTE.md). La defensa no es impedir sino que
 * quede visible en Actividad y se pueda restaurar de un toque.
 *
 * Si el grupo no se puede resolver (todavía no sincronizó, dato a medias) se
 * cae al comportamiento de siempre —el creador manda— y NO al más
 * restrictivo: quitarle el override al creador por no encontrar el grupo
 * sería una regresión silenciosa. Lo atrapó `expenseDetail.test.tsx`.
 * T-223: salió de `app/expense/[id].tsx`.
 */
export function permisosDeGasto({
  hayUsuario, isCreator, isDeleted, grupoResuelto, esMiembroDelGrupo,
}: {
  hayUsuario: boolean;
  isCreator: boolean;
  isDeleted: boolean;
  grupoResuelto: boolean;
  esMiembroDelGrupo: boolean;
}): { borradoDirecto: boolean; puedeEditar: boolean } {
  const borradoDirecto = !hayUsuario ? false
    : grupoResuelto ? esMiembroDelGrupo
    : isCreator;
  const puedeEditar = !isDeleted && (isCreator || (grupoResuelto && esMiembroDelGrupo));
  return { borradoDirecto, puedeEditar };
}

/** Mi neto en el gasto: si pagué, lo que puse menos mi parte; si no, debo mi parte. */
export function netoParaMi({ amount, myShare, isPayer }: {
  amount: number; myShare: number; isPayer: boolean;
}): number {
  return isPayer ? amount - myShare : -myShare;
}

/** Los comentarios vivos de un gasto, del más viejo al más nuevo. */
export function comentariosDelGasto(
  todos: ExpenseComment[], expenseId: string | undefined,
): ExpenseComment[] {
  return todos
    .filter(cm => cm.expenseId === expenseId && !cm.isDeleted)
    .sort((a, b) => a.createdAt - b.createdAt);
}
