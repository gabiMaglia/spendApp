import type { ActivityKind } from '@/src/store/selectors';

/**
 * Búsqueda en el feed de actividad.
 *
 * Vive fuera de la pantalla porque es lógica, no dibujo: se puede probar sin
 * renderizar nada y sirve igual si mañana se busca desde otro lado.
 *
 * Compara sin distinguir mayúsculas ni acentos — quien escribe "asado" en el
 * teclado del teléfono no va a poner el acento de "Almuerzo Ñandú", y una
 * búsqueda que exige tildes se siente rota.
 */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // saca los acentos, deja la letra base
}

/** Los textos por los que se puede encontrar un evento. */
function camposDe(ev: ActivityKind, nombreDe: (id: string) => string): string[] {
  if (ev.kind === 'payment_made') {
    return [ev.groupName, nombreDe(ev.payment.fromUserId), nombreDe(ev.payment.toUserId)];
  }
  const campos = [ev.groupName, ev.expense.description, nombreDe(ev.expense.paidById)];
  if (ev.kind === 'expense_delete_request') campos.push(ev.requestedByName);
  return campos;
}

export function searchActivity(
  feed: ActivityKind[],
  query: string,
  nombreDe: (id: string) => string = () => '',
): ActivityKind[] {
  const q = normalizar(query.trim());
  // Sin búsqueda se devuelve el feed TAL CUAL, sin copiarlo ni reordenarlo:
  // el caso normal es no estar buscando nada.
  if (q === '') return feed;
  return feed.filter(ev => camposDe(ev, nombreDe).some(campo => normalizar(campo ?? '').includes(q)));
}
