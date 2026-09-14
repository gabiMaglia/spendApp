import type { SyncDelta } from './useSyncQR';
import { useGroupStore } from '@/src/store/groupStore';

/**
 * Acota un delta recibido por el RELAY a lo que ese grupo puede legítimamente
 * traer (S3-A1, `qa/SEC3-2026-09-14.md` §2).
 *
 * `drainGroup` descifra el sobre con la clave del topic de UN grupo, pero eso
 * sólo prueba que quien lo selló tiene esa clave — no acota de ningún modo QUÉ
 * puede venir adentro. Antes de este fix el delta entero se pasaba crudo a
 * `applyDelta` (la función del pairing QR, pensada para un canal autenticado
 * por presencia física), así que un co-miembro de A podía colar la clave de
 * OTRO grupo B (con época enorme → sustitución persistente), movimientos
 * `personal` de la víctima, o un gasto con `groupId: ''` (que T-116 muestra en
 * la pestaña Personal).
 *
 * Es el espejo de `buildGroupPayload` (relaySync.ts) pero del lado receptor:
 * ese arma el sobre campo por campo con LO PROPIO; éste, ante un sobre que
 * puede ser hostil, se queda sólo con lo que declara pertenecer al `groupId`
 * del topic — nunca confía en que el emisor haya sido honesto.
 *
 * `groupKeys` y `personal` **siempre** vuelven vacíos: ningún dato de esos dos
 * campos tiene razón de ser en un sobre del relay (ADR-003 §1 — las claves
 * sólo viajan por el pairing QR).
 *
 * `users` se limita a quienes son miembros del grupo — según el registro DE
 * ESTE GRUPO que trae el propio delta (para que un miembro recién agregado se
 * vea) unión con la membresía que ya tenemos localmente (para no perder al
 * resto si el emisor no repite `groups` en este sobre). Un userId ajeno al
 * grupo no entra aunque el delta lo incluya: es lo que evita la suplantación
 * visual de S3-A1 punto 3.
 */
export function acotarDeltaAlGrupo(delta: SyncDelta, groupId: string): SyncDelta {
  const gruposDelGrupo = delta.groups.filter(g => g.id === groupId);

  const localGroup = useGroupStore.getState().groups.find(g => g.id === groupId);
  const miembros = new Set<string>([
    ...(localGroup?.memberIds ?? []),
    ...gruposDelGrupo.flatMap(g => g.memberIds ?? []),
  ]);

  const expenses = delta.expenses.filter(e => e.groupId === groupId);
  const idsDeGastos = new Set(expenses.map(e => e.id));

  return {
    version: delta.version,
    featureVersion: delta.featureVersion,
    fromUserId: delta.fromUserId,
    timestamp: delta.timestamp,

    groups: gruposDelGrupo,
    expenses,
    payments: delta.payments.filter(p => p.groupId === groupId),
    users: delta.users.filter(u => miembros.has(u.id)),
    recurring: (delta.recurring ?? []).filter(r => r.groupId === groupId),
    comments: (delta.comments ?? []).filter(c => idsDeGastos.has(c.expenseId)),

    // Nunca desde el relay: ver comentario de arriba.
    personal: [],
    groupKeys: [],
  };
}
