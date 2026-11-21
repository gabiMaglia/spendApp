import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, useWindowDimensions, type View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MAX_FILAS_COMPLETAS, altoVisibleMenu, calcularPosicionMenu,
} from '@/src/components/menu/calcularPosicionMenu';
import type { Posicion, Rect } from '@/src/components/menu/tipos';

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
  const [rect, setRect] = useState<Rect | null>(null);
  const [alturas, setAlturas] = useState<number[]>([]);
  const [sinLayout, setSinLayout] = useState(false);
  const ventanaAlAbrir = useRef<{ width: number; height: number } | null>(null);
  const filasAMedir = Math.min(cantidad, MAX_FILAS_COMPLETAS);
  const completo = alturas.length >= filasAMedir && alturas.slice(0, filasAMedir).every(h => h > 0);

  useEffect(() => {
    if (!visible) {
      ventanaAlAbrir.current = null;
      setRect(null); setAlturas([]); setSinLayout(false);
      return;
    }
    // R2: sin teclado, y se mide en el frame siguiente (ya se replegó).
    Keyboard.dismiss();
    ventanaAlAbrir.current = { width: ventana.width, height: ventana.height };
    const f = requestAnimationFrame(() => {
      ancla.current?.measureInWindow((x, y, width, height) => setRect({ x, y, width, height }));
    });
    return () => cancelAnimationFrame(f);
    // Sólo al abrir: las dimensiones se vigilan en el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, ancla]);

  // La app es vertical, pero si la ventana cambia el ancla medida ya no vale.
  useEffect(() => {
    const base = ventanaAlAbrir.current;
    if (visible && base && (base.width !== ventana.width || base.height !== ventana.height)) onCerrar();
  }, [visible, ventana.width, ventana.height, onCerrar]);

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

  const posicion: Posicion | null = useMemo(() => {
    if (!rect || !(completo || sinLayout)) return null;
    const filas = completo ? alturas : Array(filasAMedir).fill(ALTO_FILA_MINIMO);
    return calcularPosicionMenu(rect, ventana, insets, altoVisibleMenu(filas, cantidad));
  }, [rect, completo, sinLayout, alturas, filasAMedir, cantidad, ventana, insets]);

  // Ancho provisional para el frame de medición (opacidad 0).
  const anchoProvisional = rect ? calcularPosicionMenu(rect, ventana, insets, 0).width : 0;

  return { posicion, onLayoutFila, anchoProvisional, rect };
}
