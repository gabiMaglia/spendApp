import { useContext, useEffect, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';

/**
 * Relee un valor que vive FUERA de React y devuelve siempre el último.
 *
 * Existe por un defecto concreto: la pantalla de diagnóstico leía
 * `authorStats()`, `unverifiedAuthors()` y `blockingFailures()` durante el
 * render. Esas tres viven en variables de módulo que el sync actualiza por
 * detrás, y React no tiene forma de enterarse — así que los contadores se
 * quedaban congelados en el valor que tenían al montar la pantalla. El sync
 * contaba bien; lo que estaba roto era mirarlo.
 *
 * Es un sondeo, no una suscripción: para una pantalla de diagnóstico alcanza y
 * evita tener que volver observable cada módulo que se quiera inspeccionar.
 * Si algún día estos contadores se muestran en la UI real, ahí sí conviene un
 * store y no esto.
 */
/** Igualdad por CONTENIDO, no por referencia — son valores chicos de diagnóstico. */
function iguales<T>(a: T, b: T): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false; // no comparable → tratar como distinto, nunca esconder un cambio real
  }
}

export function useLiveValue<T>(read: () => T, intervalMs = 2000): T {
  const [valor, setValor] = useState<T>(read);
  // T-222: `useContext` y no `useNavigation`/`useIsFocused`, que tiran sin
  // navegador — acá la navegación es opcional (tests, componentes sueltos).
  const navegacion = useContext(NavigationContext);

  useEffect(() => {
    // T-155: `read()` suele armar un objeto NUEVO en cada llamada aunque el
    // contenido no cambió (p. ej. `{ ok: authorStats() }`) — sin comparar por
    // contenido, cada intervalo dispara un render de React de balde.
    const actualizar = () => {
      const next = read();
      setValor(prev => (iguales(prev, next) ? prev : next));
    };

    let id: ReturnType<typeof setInterval> | null = null;
    const arrancar = () => {
      if (id !== null) return;
      // Una lectura inmediata además del intervalo: si el valor cambió
      // mientras no se miraba, no hay que esperar un ciclo para verlo.
      actualizar();
      id = setInterval(actualizar, intervalMs);
    };
    const parar = () => {
      if (id === null) return;
      clearInterval(id);
      id = null;
    };

    // T-222 (medido en T-216, Moto E40): las pestañas quedan montadas y
    // congeladas al salir, y el sondeo seguía corriendo — en Cuenta, un frame
    // de 35 ms cada 2 s en reposo. Con navegador, sólo se sondea con foco.
    if (!navegacion) {
      arrancar();
      return parar;
    }
    if (navegacion.isFocused()) arrancar();
    const sinFocus = navegacion.addListener('focus', arrancar);
    const sinBlur = navegacion.addListener('blur', parar);
    return () => { sinFocus(); sinBlur(); parar(); };
    // `read` se recrea en cada render de quien llama; depender de ella
    // reiniciaría el intervalo constantemente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, navegacion]);

  return valor;
}
