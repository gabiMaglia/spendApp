import { Platform } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useSkin } from '@/src/skins/useSkin';
import { useSettingsStore } from '@/src/store/settingsStore';

function setPlatform(os: 'android' | 'ios', version: number | string): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  Object.defineProperty(Platform, 'Version', { value: version, configurable: true });
}

/** Deja resolver la consulta async de `AccessibilityInfo.isReduceMotionEnabled()`. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useSkin', () => {
  beforeEach(() => {
    setPlatform('ios', '17.0');
    useSettingsStore.setState({ skin: 'default', reduceAnimations: false });
  });

  it('con el default, no es soft y queda degradado (dibuja bandas planas)', async () => {
    const { result } = renderHook(() => useSkin());
    await flush();
    expect(result.current.id).toBe('default');
    expect(result.current.skin.flags.soft).toBe(false);
    expect(result.current.degradado).toBe(true);
  });

  it('con aero en un equipo capaz, es soft y sin degradar', async () => {
    useSettingsStore.setState({ skin: 'aero' });
    const { result } = renderHook(() => useSkin());
    await flush();
    expect(result.current.skin.flags.soft).toBe(true);
    expect(result.current.degradado).toBe(false);
  });

  it('con aero y "reducir animaciones", se degrada', async () => {
    useSettingsStore.setState({ skin: 'aero', reduceAnimations: true });
    const { result } = renderHook(() => useSkin());
    await flush();
    expect(result.current.skin.flags.soft).toBe(true);
    expect(result.current.degradado).toBe(true);
  });

  it('con aero en Android de gama baja (API 28), se degrada', async () => {
    setPlatform('android', 28);
    useSettingsStore.setState({ skin: 'aero' });
    const { result } = renderHook(() => useSkin());
    await flush();
    expect(result.current.degradado).toBe(true);
  });

  it('cambia al cambiar la preferencia', async () => {
    const { result, rerender } = renderHook(() => useSkin());
    await flush();
    act(() => { useSettingsStore.setState({ skin: 'aero' }); });
    rerender({});
    expect(result.current.id).toBe('aero');
  });
});
