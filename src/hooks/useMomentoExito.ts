import { useCallback, useRef, useState } from 'react';

import type { Momento } from '@/src/components/MomentoExito';

/** Estado del momento de cierre: quien guarda llama `mostrar`, la pantalla pinta `momento`. */
export function useMomentoExito() {
  const [momento, setMomento] = useState<Momento | null>(null);
  const contador = useRef(0);
  const mostrar = useCallback((m: Omit<Momento, 'clave'>) => {
    contador.current += 1;
    setMomento({ ...m, clave: contador.current });
  }, []);
  return { momento, mostrar };
}
