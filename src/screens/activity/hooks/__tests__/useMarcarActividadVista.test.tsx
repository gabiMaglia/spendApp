import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { NavigationContext } from '@react-navigation/native';
import { useMarcarActividadVista } from '@/src/screens/activity/hooks/useMarcarActividadVista';
import { useSettingsStore } from '@/src/store/settingsStore';

/**
 * Se marca «visto» al SALIR de Actividad (blur), no al entrar: mientras estás
 * adentro seguís viendo cuántos eran nuevos (PO 2026-09-29).
 */
function navegacion() {
  const oyentes: Record<string, Set<() => void>> = { blur: new Set(), focus: new Set() };
  return {
    isFocused: () => true,
    addListener: (ev: string, cb: () => void) => { oyentes[ev].add(cb); return () => oyentes[ev].delete(cb); },
    emitir: (ev: string) => oyentes[ev].forEach(cb => cb()),
  };
}

beforeEach(() => useSettingsStore.setState({ actividadVistaHasta: 0 }));

describe('useMarcarActividadVista', () => {
  it('al salir de la pestaña guarda la hora como «visto hasta»', () => {
    const nav = navegacion();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <NavigationContext.Provider value={nav as never}>{children}</NavigationContext.Provider>;
    renderHook(() => useMarcarActividadVista(), { wrapper });
    expect(useSettingsStore.getState().actividadVistaHasta).toBe(0);
    const antes = Date.now();
    act(() => nav.emitir('blur'));
    expect(useSettingsStore.getState().actividadVistaHasta).toBeGreaterThanOrEqual(antes);
  });

  it('sin navegador no hace nada ni rompe', () => {
    renderHook(() => useMarcarActividadVista());
    expect(useSettingsStore.getState().actividadVistaHasta).toBe(0);
  });
});
