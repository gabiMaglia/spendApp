import { renderHook, act } from '@testing-library/react-native';
import { useLiveValue } from '../useLiveValue';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useLiveValue', () => {
  it('devuelve el valor inicial', () => {
    const { result } = renderHook(() => useLiveValue(() => 7, 1000));
    expect(result.current).toBe(7);
  });

  it('refleja un cambio que ocurrio FUERA de React', () => {
    // Este es el bug real: un contador de modulo que el sync incrementa por
    // detras. Sin sondeo, la pantalla se queda con el valor del montaje.
    let contador = 0;
    const { result } = renderHook(() => useLiveValue(() => contador, 1000));
    expect(result.current).toBe(0);

    contador = 5; // el sync incrementa; React no se entera de nada
    act(() => { jest.advanceTimersByTime(1000); });
    expect(result.current).toBe(5);
  });

  it('sigue actualizando en cada intervalo', () => {
    let contador = 0;
    const { result } = renderHook(() => useLiveValue(() => contador, 500));
    contador = 1; act(() => { jest.advanceTimersByTime(500); });
    expect(result.current).toBe(1);
    contador = 2; act(() => { jest.advanceTimersByTime(500); });
    expect(result.current).toBe(2);
  });

  it('limpia el intervalo al desmontar', () => {
    const read = jest.fn(() => 1);
    const { unmount } = renderHook(() => useLiveValue(read, 100));
    unmount();
    const llamadas = read.mock.calls.length;
    act(() => { jest.advanceTimersByTime(1000); });
    expect(read.mock.calls.length).toBe(llamadas);
  });

  // T-155: un `read()` que arma un objeto NUEVO con el mismo contenido en
  // cada sondeo (p. ej. `{ ok: authorStats() }`) no puede disparar un render
  // de React por cada intervalo — el valor no cambió, sólo cambió la
  // referencia.
  it('no re-renderiza si el objeto es nuevo pero igual en contenido', () => {
    let renders = 0;
    const read = () => ({ a: 1, b: 'x' }); // objeto NUEVO en cada llamada
    const { result } = renderHook(() => {
      renders++;
      return useLiveValue(read, 100);
    });

    const rendersIniciales = renders;
    act(() => { jest.advanceTimersByTime(300); }); // 3 intervalos

    expect(renders).toBe(rendersIniciales); // ningún render de más
    expect(result.current).toEqual({ a: 1, b: 'x' });
  });
});
