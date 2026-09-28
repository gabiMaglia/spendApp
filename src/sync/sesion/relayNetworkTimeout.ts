import { onCaptchaInteractiveChange } from './captchaBridge';

/**
 * Igual que `withTimeout`, pero el tope de RED se PAUSA mientras el widget
 * de Turnstile está en modo interactivo (BUG "no se pudo confirmar tu
 * acceso" — evidencia de campo del PO): esa espera es HUMANA, la decide la
 * persona (el propio widget tiene su aviso "atascado" + Reintentar, no hace
 * falta un segundo tope acá encima). Al salir de interactivo el tope
 * arranca de cero para lo que quede (p.ej. `signInAnonymously`).
 *
 * Salió de `relaySession.ts` (T-192): es una utilidad genérica de timeout,
 * sin estado de sesión propio.
 */
export function withNetworkTimeout<T>(fn: () => Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>(resolve => {
    let resuelto = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const desarmar = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const armar = () => {
      desarmar();
      timer = setTimeout(() => {
        if (resuelto) return;
        resuelto = true;
        desuscribir();
        resolve(fallback);
      }, ms);
    };

    const desuscribir = onCaptchaInteractiveChange(activo => {
      if (resuelto) return;
      if (activo) desarmar();
      else armar();
    });

    armar();

    fn().then(
      v => {
        if (resuelto) return;
        resuelto = true;
        desarmar();
        desuscribir();
        resolve(v);
      },
      () => {
        if (resuelto) return;
        resuelto = true;
        desarmar();
        desuscribir();
        resolve(fallback);
      },
    );
  });
}
