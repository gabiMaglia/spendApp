import { act, renderHook } from '@testing-library/react-native';

import { useAbanicoAnclado } from '@/src/components/menu/useAbanicoAnclado';

describe('useAbanicoAnclado', () => {
  it('nace cerrado, abre, cierra y expone el ancla', () => {
    const { result } = renderHook(() => useAbanicoAnclado());
    expect(result.current.abierto).toBe(false);
    expect(result.current.ancla.current).toBeNull();
    act(() => result.current.abrir());
    expect(result.current.abierto).toBe(true);
    act(() => result.current.cerrar());
    expect(result.current.abierto).toBe(false);
  });
});
