import { useContext, useEffect } from 'react';
import { NavigationContext } from '@react-navigation/native';
import { useSettingsStore } from '@/src/store/settingsStore';

/**
 * Marca Actividad como vista al SALIR de la pestaña (blur), no al entrar:
 * mientras estás adentro seguís viendo cuántos movimientos eran nuevos (PO
 * 2026-09-29). `useContext` y no `useNavigation`: sin navegador (tests) no rompe.
 */
export function useMarcarActividadVista(): void {
  const navegacion = useContext(NavigationContext);
  const marcar = useSettingsStore(s => s.setActividadVistaHasta);
  useEffect(() => {
    if (!navegacion) return;
    return navegacion.addListener('blur', () => marcar(Date.now()));
  }, [navegacion, marcar]);
}
