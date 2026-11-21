import { useEffect, useRef, useState } from 'react';
import { Keyboard, useWindowDimensions, type View } from 'react-native';

import type { Rect } from '@/src/components/menu/tipos';

/**
 * Mide el disparador al abrir (R2: sin teclado, un frame después de bajarlo) y
 * cierra si la ventana cambia, porque entonces el rect medido ya no vale.
 * `null` hasta tener la medida. Al cerrar NO se limpia: la salida animada
 * necesita seguir en su lugar.
 */
export function useRectAncla({ visible, ancla, onCerrar }: {
  visible: boolean;
  ancla: React.RefObject<View | null>;
  onCerrar: () => void;
}) {
  const ventana = useWindowDimensions();
  const [rect, setRect] = useState<Rect | null>(null);
  const ventanaAlAbrir = useRef<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!visible) { ventanaAlAbrir.current = null; return; }
    setRect(null);
    Keyboard.dismiss();
    ventanaAlAbrir.current = { width: ventana.width, height: ventana.height };
    const f = requestAnimationFrame(() => {
      ancla.current?.measureInWindow((x, y, width, height) => setRect({ x, y, width, height }));
    });
    return () => cancelAnimationFrame(f);
    // Sólo al abrir: las dimensiones se vigilan en el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, ancla]);

  useEffect(() => {
    const base = ventanaAlAbrir.current;
    if (visible && base && (base.width !== ventana.width || base.height !== ventana.height)) onCerrar();
  }, [visible, ventana.width, ventana.height, onCerrar]);

  return rect;
}
