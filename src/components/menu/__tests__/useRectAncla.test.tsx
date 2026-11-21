import { act, renderHook } from '@testing-library/react-native';

import { useRectAncla } from '@/src/components/menu/useRectAncla';

let mockY = 200;
const ancla = { current: { measureInWindow: (cb: any) => cb(36, mockY, 60, 60) } } as any;

describe('useRectAncla', () => {
  beforeEach(() => { jest.useFakeTimers(); mockY = 200; });
  afterEach(() => { jest.useRealTimers(); });

  it('(d) en el render de la reapertura nunca devuelve el rect de la apertura anterior', () => {
    const vistos: unknown[] = [];
    const { rerender } = renderHook(({ visible }: { visible: boolean }) => {
      const r = useRectAncla({ visible, ancla, onCerrar: () => {} });
      vistos.push(r);
      return r;
    }, { initialProps: { visible: true } });
    act(() => { jest.advanceTimersByTime(20); });
    expect(vistos[vistos.length - 1]).toEqual({ x: 36, y: 200, width: 60, height: 60 });

    rerender({ visible: false });
    expect(vistos[vistos.length - 1]).not.toBeNull(); // al cerrar se conserva (la salida lo necesita)

    vistos.length = 0;
    mockY = 300;
    rerender({ visible: true });
    expect(vistos.length).toBeGreaterThan(0);
    expect(vistos.every(v => v === null)).toBe(true);
    act(() => { jest.advanceTimersByTime(20); });
    expect(vistos[vistos.length - 1]).toEqual({ x: 36, y: 300, width: 60, height: 60 });
  });
});
