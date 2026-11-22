import { useCallback, useRef, useState } from 'react';
import type { View } from 'react-native';

/**
 * Lo que comparten todos los disparadores de un `AbanicoCubos`: el ancla que
 * el abanico mide y si está abierto. El doble toque (abre y cierra) y el
 * ASENTAR viven en el abanico, no acá.
 */
export function useAbanicoAnclado() {
  const ancla = useRef<View>(null);
  const [abierto, setAbierto] = useState(false);
  const abrir = useCallback(() => setAbierto(true), []);
  const cerrar = useCallback(() => setAbierto(false), []);
  return { ancla, abierto, abrir, cerrar };
}
