import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useAuthStore } from '@/src/store/authStore';
import { procesarUrlEntrante } from '@/src/utils/enlacePendiente';

/**
 * **Escucha los links que llegan y decide, al llegar, si quedan pendientes** (T-094).
 *
 * Reemplaza a `Linking.useURL()`, que retiene la última URL: un efecto que dependía de
 * la sesión la re-guardaba en cada logout, y el login siguiente —de cualquier cuenta—
 * la abría. Con sesión el link lo abre expo-router (pasando por `+native-intent`); acá
 * sólo se marca como usado.
 *
 * Mientras la sesión se hidrata no se sabe si hay usuario: se espera a que termine.
 */
export function useEnlacesEntrantes(): void {
  useEffect(() => {
    let vivo = true;
    const esperas: (() => void)[] = [];

    const procesar = (url: string | null) => {
      if (!vivo || !url) return;
      const estado = useAuthStore.getState();
      if (!estado.isLoading) {
        procesarUrlEntrante(url, estado.currentUser !== null);
        return;
      }
      const dejar = useAuthStore.subscribe(s => {
        if (s.isLoading) return;
        dejar();
        if (vivo) procesarUrlEntrante(url, s.currentUser !== null);
      });
      esperas.push(dejar);
    };

    void Linking.getInitialURL().then(procesar).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => procesar(url));

    return () => {
      vivo = false;
      sub.remove();
      esperas.forEach(d => d());
    };
  }, []);
}
