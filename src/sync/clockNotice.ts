import { createSecureStorage } from '@/src/utils/secureStorage';
import { clockIsOff, clockOffsetMs } from '@/src/utils/syncedClock';
import type { Notice } from '@/src/services/syncNotices';

/**
 * Avisar que el reloj del teléfono está mal (T-038).
 *
 * **Por qué hace falta si el merge ya está corregido:** `syncedNow()` corrige
 * `updatedAt` contra el reloj del relay, así que los conflictos se resuelven
 * bien aunque la hora esté mal. Pero eso **no arregla lo que el usuario ve**:
 * un teléfono con la hora corrida muestra los gastos con la fecha equivocada, y
 * ningún desfase interno lo corrige. Quien lo sufra va a reportar «las fechas
 * están raras» y nadie va a saber por qué.
 *
 * Hasta hoy `clockIsOff()` existía y **sólo lo consumía una pantalla DEV**
 * (`app/debug/identity.tsx`): la app sabía que tu reloj estaba mal y no te lo
 * decía. Es el mismo defecto que T-037 vino a cerrar, en otro lugar.
 *
 * **Avisa UNA vez.** Se evalúa en cada publicación —cada pocos segundos— y un
 * aviso por intento no es informar: es entrenar al usuario a ignorar los
 * avisos, y el que ignora después es el que importa. La marca se persiste,
 * igual que en `syncDownNotices.ts`.
 *
 * **Y se olvida sola cuando el reloj se arregla**, así que un desvío nuevo más
 * adelante vuelve a poder avisar. Sin eso, la primera vez sería la única.
 */
const storage = createSecureStorage('notices');

/** Sin scope de cuenta: el reloj es del aparato, como el desfase mismo. */
const KEY = 'clock_off_v1';

export function noticeDeReloj(): Notice | null {
  if (!clockIsOff()) {
    // El reloj está bien —o nunca hablamos con el relay, que da desfase 0 y el
    // umbral descarta solo—: se limpia la marca para poder volver a avisar.
    storage.delete(KEY);
    return null;
  }

  if (storage.getString(KEY)) return null;

  storage.set(KEY, '1');
  return { kind: 'clock_off', offsetMs: clockOffsetMs() };
}

/** Sólo para tests. */
export function olvidarAvisoDeReloj(): void {
  storage.delete(KEY);
}
