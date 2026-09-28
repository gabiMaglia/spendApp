import * as adaptador from '@/src/sync/adaptadores/hushsplit/adaptadorHushSplit';
import { DELTA_FEATURE_VERSION, type SyncDelta } from '@/src/sync/adaptadores/hushsplit/applyDelta';

/**
 * T-206-A (D1/D2): reemplaza a `buildGroupPayload`/`buildDelta` en los tests.
 *
 * Los dos armaban el sobre por su cuenta — `buildDelta` era el delta completo
 * del pairing QR (`useSyncQR.ts`, borrado en T-193) y `buildGroupPayload`
 * (`motor/publicar.ts`) quedó como una segunda implementación del mismo
 * armado que YA NO usa `publishToGroup` (el camino real: `adaptador.armar` +
 * `adaptador.antesDePublicar`, ver `motor/publicar.ts:204-208`). Esta función
 * es ese mismo armado, envuelto como `SyncDelta` para poder pasarlo a
 * `applyDelta` en los tests — lo que de verdad sale por el relay hoy.
 *
 * `timestamp: Date.now()` (no fijo en `0` como `envolver`) porque acá no hace
 * falta que el JSON sea determinista entre llamadas — eso sólo importa para
 * el digest de una rebanada (`sliceLedger`), no para armar un delta de test.
 */
export function armarComoDelta(groupId: string, currentUserId: string): SyncDelta {
  const doc = adaptador.armar(groupId, currentUserId);
  return {
    version: 1,
    featureVersion: DELTA_FEATURE_VERSION,
    fromUserId: currentUserId,
    timestamp: Date.now(),
    groups: doc.groups as SyncDelta['groups'],
    expenses: doc.expenses as SyncDelta['expenses'],
    payments: doc.payments as SyncDelta['payments'],
    users: doc.users as SyncDelta['users'],
    recurring: doc.recurring as SyncDelta['recurring'],
    comments: doc.comments as SyncDelta['comments'],
  };
}
