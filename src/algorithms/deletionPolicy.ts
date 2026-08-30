import type { DeletionMode, Group } from '@/src/types/models';

/**
 * Cómo se borra un gasto en un grupo. Se elige al CREAR el grupo (decisión del
 * PO, 2026-08-30) y define dos mundos distintos:
 *
 * - **`consensus`** — la regla #2 de este proyecto: pedir el borrado, 72hs para
 *   que alguien objete, y el creador del gasto puede forzarlo. Previene.
 * - **`open`** — el modelo de Splitwise: cualquiera del grupo borra al instante
 *   y cualquiera restaura desde Actividad. No previene: hace visible y
 *   reversible. Splitwise lo tiene así a propósito, para que cualquiera pueda
 *   arreglar un error sin pedir permiso.
 *
 * Ninguno es "más seguro" en abstracto. El consenso protege de un borrado
 * malicioso; el abierto protege de un error que nadie puede arreglar porque el
 * que lo cargó no está. Por eso lo elige el grupo y no nosotros.
 */

/**
 * Un grupo sin el campo es uno creado antes de que esto existiera: cae a
 * `consensus`, el modo MÁS restrictivo. Un grupo nunca se afloja solo — hacerlo
 * cambiaría en retroactivo un acuerdo que sus miembros ya habían tomado.
 */
export function deletionModeOf(group: Pick<Group, 'deletionMode'>): DeletionMode {
  return group.deletionMode === 'open' ? 'open' : 'consensus';
}

/** ¿Este borrado se aplica ya, o abre una ronda de consenso? */
export function borraAlInstante(
  group: Pick<Group, 'deletionMode' | 'memberIds'>,
  quienBorra: string,
  autorDelGasto: string,
): boolean {
  // Fuera del grupo no se borra nada, sea cual sea el modo. El modo abierto
  // afloja quién decide DENTRO del grupo, no quién puede entrar.
  if (!group.memberIds.includes(quienBorra)) return false;
  if (deletionModeOf(group) === 'open') return true;
  return quienBorra === autorDelGasto; // override del creador (regla #2)
}

/**
 * Restaurar es siempre de cualquier miembro, en los dos modos.
 *
 * Deshacer no puede ser más difícil que hacer: si en modo consenso hizo falta
 * una ronda para borrar, exigir otra ronda para revertir dejaría un error
 * clavado hasta que se junten los votos. Y en modo abierto es la contraparte
 * exacta de que borrar sea libre.
 */
export function puedeRestaurar(
  group: Pick<Group, 'memberIds'>,
  quienRestaura: string,
): boolean {
  return group.memberIds.includes(quienRestaura);
}
