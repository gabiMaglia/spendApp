import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWindowDimensions, type View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BORDE_MENU, MAX_FILAS_COMPLETAS, altoVisibleMenu, calcularPosicionMenu,
} from '@/src/components/menu/calcularPosicionMenu';
import { useRectAncla } from '@/src/components/menu/useRectAncla';
import type { Posicion } from '@/src/components/menu/tipos';

/** Alto de reserva de una fila si el sistema no reporta layout (Android, primer frame en 0). */
const ALTO_FILA_MINIMO = 56;

/**
 * Mide el disparador y las primeras filas, y decide dónde cae el menú.
 * `posicion` es `null` hasta tener todo medido: mientras tanto el menú vive
 * en opacidad 0 para poder medirlo sin que se vea saltar.
 */
export function usePosicionMenu({ visible, ancla, cantidad, onCerrar }: {
  visible: boolean;
  ancla: React.RefObject<View | null>;
  cantidad: number;
  onCerrar: () => void;
}) {
  const ventana = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const rect = useRectAncla({ visible, ancla, onCerrar });
  const [alturas, setAlturas] = useState<number[]>([]);
  const [sinLayout, setSinLayout] = useState(false);
  const filasAMedir = Math.min(cantidad, MAX_FILAS_COMPLETAS);
  const completo = alturas.length >= filasAMedir && alturas.slice(0, filasAMedir).every(h => h > 0);

  useEffect(() => { if (visible) { setAlturas([]); setSinLayout(false); } }, [visible]);

  // Si en 2 frames no llegó ningún layout, se sigue con el alto mínimo.
  useEffect(() => {
    if (!rect || completo) return;
    let f2 = 0;
    const f1 = requestAnimationFrame(() => { f2 = requestAnimationFrame(() => setSinLayout(true)); });
    return () => { cancelAnimationFrame(f1); cancelAnimationFrame(f2); };
  }, [rect, completo]);

  const onLayoutFila = useCallback((i: number, alto: number) => {
    setAlturas(prev => {
      if (prev[i] === alto) return prev;
      const sig = [...prev]; sig[i] = alto; return sig;
    });
  }, []);

  // El alto total incluye el borde (border-box); `maxHeight` sólo existe si hay que
  // recortar: más de 5 opciones, o poco espacio. Con ≤5 el menú mide lo que sus filas.
  const { posicion, maxHeight } = useMemo(() => {
    if (!rect || !(completo || sinLayout)) return { posicion: null, maxHeight: undefined };
    const filas = completo ? alturas : Array(filasAMedir).fill(ALTO_FILA_MINIMO);
    const total = altoVisibleMenu(filas, cantidad) + 2 * BORDE_MENU;
    const p: Posicion = calcularPosicionMenu(rect, ventana, insets, total);
    const recortado = cantidad > MAX_FILAS_COMPLETAS || p.maxHeight < total;
    return { posicion: p, maxHeight: recortado ? p.maxHeight : undefined };
  }, [rect, completo, sinLayout, alturas, filasAMedir, cantidad, ventana, insets]);

  // Ancho provisional para el frame de medición (opacidad 0).
  const anchoProvisional = rect ? calcularPosicionMenu(rect, ventana, insets, 0).width : 0;

  return { posicion, maxHeight, onLayoutFila, anchoProvisional, rect };
}
