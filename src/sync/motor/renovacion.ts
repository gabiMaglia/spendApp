import { groupKeyBytes, useGroupKeyStore } from '@/src/store/groupKeyStore';
import { deriveTopic } from '@/src/sync/nucleo/envelopeCrypto';
import { publicadoMasViejoEn } from '@/src/sync/nucleo/sliceLedger';
import { RENEWAL_WINDOW_MS } from '@/src/sync/nucleo/limites';
import * as adaptador from '@/src/sync/adaptadores/hushsplit/adaptadorHushSplit';
import { syncableGroupIds, publishNow, publicacionOcupada } from './agendaDePublicacion';
import { deviceId } from './cursor';
import { recordError } from '@/src/services/errorLog';

/** Entre dos intentos de renovar el mismo grupo: no es urgente, no se martilla. */
const ENFRIAMIENTO_RENOVACION_MS = 60 * 60_000;
/**
 * Si tras un envío OK el cubo más viejo sigue vencido, es huérfano (una ckey
 * que `publicarPorCubos` ya no regenera ni olvida): repetirlo cada hora sería
 * para siempre. Se espera un día.
 */
const ENFRIAMIENTO_SIN_EFECTO_MS = 24 * 60 * 60_000;
const proximoIntento = new Map<string, number>();

/**
 * Renovación contra el TTL del buzón (T-267).
 *
 * El buzón borra todo a los 30 días (`001_mailbox.sql`) y `publicarPorCubos`
 * sólo renueva dentro de una publicación, que sólo ocurre por un cambio local:
 * un grupo quieto vencía aunque todos abrieran la app a diario. Acá, en el
 * ciclo de sync (arranque y poll, DESPUÉS de drenar: guarda T-089), se mira el
 * cubo propio más viejo del ledger; si pasó `RENEWAL_WINDOW_MS` (20 d, 10 d de
 * margen) se publica, y `publicarPorCubos` reenvía justo los cubos vencidos
 * más el manifiesto — el mismo chequeo de siempre, sin formato nuevo.
 *
 * Sin tormenta: la `ckey` es por aparato, así que cada miembro renueva SÓLO
 * sus propios sobres y con el reloj de SU ledger (los relojes no están
 * sincronizados entre miembros). Tras renovar el ledger se actualiza y no
 * vuelve a disparar hasta dentro de otros 20 días; mientras tanto, el
 * enfriamiento evita reintentar en cada poll si el envío falla.
 */
export async function renovarGruposVencidos(): Promise<void> {
  const ahora = Date.now();
  for (const groupId of syncableGroupIds()) {
    if (publicacionOcupada(groupId, ahora)) continue;
    if (ahora < (proximoIntento.get(groupId) ?? -Infinity)) continue;

    const key = groupKeyBytes(groupId);
    const record = useGroupKeyStore.getState().getKey(groupId);
    if (!key || !record) continue;
    const topic = await deriveTopic(key, record.epoch);
    const masViejo = publicadoMasViejoEn(adaptador.almacen, topic, deviceId());
    if (masViejo === null || ahora - masViejo <= RENEWAL_WINDOW_MS) continue;

    proximoIntento.set(groupId, ahora + ENFRIAMIENTO_RENOVACION_MS);
    const r = await publishNow(groupId);
    if (r.ok) {
      const despues = publicadoMasViejoEn(adaptador.almacen, topic, deviceId());
      if (despues !== null && ahora - despues > RENEWAL_WINDOW_MS) {
        proximoIntento.set(groupId, ahora + ENFRIAMIENTO_SIN_EFECTO_MS);
      }
    }
  }
}

/** Sólo para tests. */
export function __resetRenovaciones(): void {
  proximoIntento.clear();
}

/** Para la cadena de sync: un fallo de la renovación no puede cortar el gancho post-sync. */
export async function renovarSinRomper(): Promise<void> {
  try {
    await renovarGruposVencidos();
  } catch (e) {
    recordError({ message: `sync.renovacion_fallo ${String(e)}`, fatal: false, screen: 'sync' });
  }
}
