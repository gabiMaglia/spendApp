import type { Group } from '@/src/types/models';
import { mismaPersona } from '@/src/store/identityAlias';

/**
 * **Qué grupos cuentan para mis deudas** (T-225): una sola regla, usada por los
 * casilleros y las tarjetas (`selectoresDeDeuda`) y por Saldar desde Amigos
 * (`saldoSinCompensar`).
 *
 * - Un grupo borrado no se puede saldar (no hay pantalla donde hacerlo).
 * - Uno archivado ya tiene su saldo trasladado (T-058) o lo saqué a mano de la
 *   vista: sumarlo lo contaría dos veces junto con el que lo sucedió.
 * - «Ser parte» incluye estar en el roster con la identidad vieja (T-048 · D-6):
 *   si no, un grupo heredado desaparecía con sus saldos adentro.
 */
export function gruposQueCuentan(groups: Group[], archivedIds: string[], userId: string): Group[] {
  return groups.filter(g =>
    !g.isDeleted
    && !archivedIds.includes(g.id)
    && g.memberIds.some(m => mismaPersona(m, userId)));
}
