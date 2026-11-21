import { useEffect, useRef } from 'react';

/**
 * Guard de elección: se puede elegir sólo con el menú abierto y medido (`tocable`),
 * y una sola vez por apertura. Cubre el doble toque y el toque durante la salida,
 * que sigue montada unos ms (lección T-282).
 */
export function useEleccionUnica<V>({ visible, tocable, onElegir, onClose }: {
  visible: boolean;
  tocable: boolean;
  onElegir: (v: V) => void;
  onClose: () => void;
}) {
  const elegido = useRef(false);
  useEffect(() => { if (visible) elegido.current = false; }, [visible]);

  return (v: V) => {
    if (!tocable || elegido.current) return;
    elegido.current = true;
    onElegir(v);
    onClose();
  };
}
