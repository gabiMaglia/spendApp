import type { DeletionMode, Group } from '@/src/types/models';
import { mismaPersona } from '@/src/store/identityAlias';

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
  /**
   * Las tres comparaciones pasan por `mismaPersona` (T-048 · D-3). Quien enlazó
   * dos cuentas figura en el roster de sus grupos viejos con la identidad
   * ANTERIOR, y su gasto de entonces lleva ese mismo id en `createdById` — nada
   * de eso se reescribe (D-6). Sin traducir: no podría borrar en su propio
   * grupo, y el override del creador no se le aplicaría a su propio gasto.
   *
   * Es `mismaPersona` y no `idCanonico` porque este módulo está en el grafo de
   * imports del sobre de sync: acá sólo puede entrar un primitivo que devuelva
   * un booleano, nunca uno que devuelva un id.
   */
  if (!group.memberIds.some(m => mismaPersona(m, quienBorra))) return false;
  if (deletionModeOf(group) === 'open') return true;
  return mismaPersona(quienBorra, autorDelGasto); // override del creador (regla #2)
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
  return group.memberIds.some(m => mismaPersona(m, quienRestaura));
}

/**
 * Con qué modo se queda un grupo cuando llega una versión remota de él.
 *
 * **El modo NO se sincroniza.** El `Group` viaja entero en el sobre
 * (`relaySync.ts:60`) y el merge es LWW: sin esto, cualquier miembro puede
 * mandar el grupo con `deletionMode: 'open'`, ganarle por `updatedAt`, y a
 * partir de ahí borrar gastos ajenos al instante sin que nadie lo autorice.
 * Eso vacía la regla #2 del proyecto por el canal de sync.
 *
 * La regla es: **el modo lo fija quien crea el grupo y después no lo mueve
 * nadie.** Sólo se toma el del sobre la PRIMERA vez que este dispositivo ve el
 * grupo, que es cómo un miembro nuevo se entera de en qué mundo entró.
 *
 * No se pierde ninguna funcionalidad: hoy el modo se elige únicamente al crear
 * el grupo (`app/groups/new.tsx:81`) y no hay ninguna pantalla para cambiarlo.
 * El día que se quiera permitir cambiarlo, va a hacer falta autorización de
 * verdad (T-041), no un campo que gana por timestamp.
 */
export function mergeDeletionMode(
  conocidoLocal: boolean,
  local: DeletionMode | undefined,
  remoto: DeletionMode | undefined,
): DeletionMode | undefined {
  return conocidoLocal ? local : remoto;
}
