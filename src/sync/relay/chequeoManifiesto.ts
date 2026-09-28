import type { GroupKey } from '../envelopeCrypto';
import { digestOfJson, type SliceManifest } from '../manifest';
import { recordManifestCheck } from '../manifestHealth';
import { recordError } from '@/src/services/errorLog';
import * as adaptador from './adaptadorHushSplit';
import * as appliedSlices from './appliedSlices';
import { permite as permiteRelectura } from './relecturas';
import { releerFaltantes } from './relectura';
import { faltantesSoloRetenidas } from './cierreDeDrenaje';

/**
 * Chequeo de manifiesto (T-192, Task 4 — salió de `drenar.ts` para que
 * quedara bajo 260 líneas): se corre UNA vez, al final del drenaje, y sólo
 * si se leyó hasta el fondo. Un gap NUNCA descarta rebanadas que sí
 * llegaron: sólo se REGISTRA para avisar en la UI (spec §7/§8 C5(c)/C6).
 */
export async function chequearManifiestos(
  groupId: string,
  currentUserId: string,
  deviceId: string,
  topic: string,
  key: GroupKey,
  record: { key: string; epoch: number },
  manifiestos: { sender: string; manifest: SliceManifest; senderKey: string; seq: number }[],
  recibidasPorRemitente: Map<string, Map<string, string>>,
  noResueltas: { sender: string; ckey?: string }[],
): Promise<void> {
  try {
    const faltantesTotales: string[] = [];
    for (const { sender, manifest, senderKey: senderKeyManifiesto, seq: seqManifiesto } of manifiestos) {
      const recibidas = recibidasPorRemitente.get(sender) ?? new Map<string, string>();
      let faltantes: { ckey: string; digest: string }[] = [];
      for (const entry of manifest.entries) {
        const json = recibidas.get(entry.ckey);
        const digestRecibido = json !== undefined ? await digestOfJson(json) : undefined;
        const aplicada = appliedSlices.leer(adaptador.almacen, topic, sender, entry.ckey);
        if (!appliedSlices.entradaCumplida(entry, seqManifiesto, senderKeyManifiesto, digestRecibido, aplicada)) {
          faltantes.push(entry);
        }
      }

      // Ajuste C: una ckey retenida sin resolver NO dispara relectura — el
      // sobre ya está en mano, releerlo no cambia nada.
      const ckeysNoResueltasDeEsteSender = new Set(
        noResueltas.filter(n => n.sender === sender && n.ckey).map(n => n.ckey!),
      );
      const todosSonRetenidas = faltantesSoloRetenidas(faltantes, ckeysNoResueltasDeEsteSender);

      if (faltantes.length > 0 && !todosSonRetenidas && permiteRelectura(topic, sender, seqManifiesto)) {
        const siguenFaltando = await releerFaltantes(
          groupId, currentUserId, deviceId, topic, key, record, sender, faltantes,
        );
        faltantes = faltantes.filter(f => siguenFaltando.includes(f.ckey));
      }
      faltantesTotales.push(...faltantes.map(f => f.ckey));
    }
    recordManifestCheck(groupId, faltantesTotales);
  } catch (e) {
    recordError({
      message: `sync.manifest_check_failed topic=${topic.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : undefined,
      fatal: false,
      screen: 'sync',
    });
  }
}
