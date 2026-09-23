import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useSettingsStore } from '@/src/store/settingsStore';

/**
 * Fuente única de verdad para "¿animo o no?" (PO 2026-09-22), usada por
 * `MontoRodante` (odómetro de dígitos) y `Sheet` (entrada/salida animada).
 * Antes cada componente hacía su propia consulta a `AccessibilityInfo` por
 * separado; ahora las dos señales viven en un solo lugar:
 *
 * 1. El toggle manual "Reducir animaciones" en Yo (`settingsStore`), cuyo
 *    default sale de `esDispositivoDeGamaBaja()` — ver `deviceTier.ts`.
 * 2. "Reducir movimiento" del sistema operativo (accesibilidad).
 *
 * Cualquiera de las dos activa alcanza para apagar la animación. Devuelve
 * `null` mientras la consulta de accesibilidad (async) todavía no resolvió —
 * igual que hacía `MontoRodante` antes, para no animar una sola vez de más
 * en el primer render si el sistema tiene "reducir movimiento" prendido.
 */
export function useAnimacionesReducidas(): boolean | null {
  const manual = useSettingsStore(s => s.reduceAnimations);
  const [os, setOs] = useState<boolean | null>(null);

  useEffect(() => {
    let vivo = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (vivo) setOs(v); })
      .catch(() => { if (vivo) setOs(false); });
    return () => { vivo = false; };
  }, []);

  if (manual) return true;
  if (os === null) return null;
  return os;
}
