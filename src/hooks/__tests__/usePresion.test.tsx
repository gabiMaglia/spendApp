import { act, renderHook } from '@testing-library/react-native';

import { ESCALA_PRESION, RESORTE_MARCA } from '@/src/constants/movimiento';
import { usePresion } from '@/src/hooks/usePresion';
import { useSettingsStore } from '@/src/store/settingsStore';

const mockSpring = jest.fn((v: number) => v);
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const base = require('react-native-reanimated/mock');
  return { ...base, withSpring: (...a: [number]) => mockSpring(...a) };
});

describe('usePresion', () => {
  beforeEach(() => { mockSpring.mockClear(); useSettingsStore.setState({ reduceAnimations: false }); });

  it('al presionar escala a ESCALA_PRESION con el resorte de la marca, y al soltar vuelve a 1', () => {
    const { result } = renderHook(() => usePresion());
    act(() => { result.current.alPresionar(); });
    expect(mockSpring).toHaveBeenLastCalledWith(ESCALA_PRESION, RESORTE_MARCA);
    act(() => { result.current.alSoltar(); });
    expect(mockSpring).toHaveBeenLastCalledWith(1, RESORTE_MARCA);
  });

  it('con reducir movimiento no anima nada', () => {
    useSettingsStore.setState({ reduceAnimations: true });
    const { result } = renderHook(() => usePresion());
    act(() => { result.current.alPresionar(); result.current.alSoltar(); });
    expect(mockSpring).not.toHaveBeenCalled();
  });
});
