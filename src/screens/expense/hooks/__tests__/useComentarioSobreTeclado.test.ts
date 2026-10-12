import { act, renderHook } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { useComentarioSobreTeclado } from '../useComentarioSobreTeclado';

type Listener = () => void;
let alMostrar: Listener | undefined;
const remove = jest.fn();

beforeEach(() => {
  alMostrar = undefined;
  remove.mockClear();
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((evento: string, fn: Listener) => {
    if (evento === 'keyboardDidShow') alMostrar = fn;
    return { remove } as never;
  }) as never);
});

afterEach(() => { jest.restoreAllMocks(); });

function montar() {
  const scrollToEnd = jest.fn();
  const r = renderHook(() => useComentarioSobreTeclado());
  (r.result.current.scrollRef as { current: unknown }).current = { scrollToEnd };
  return { ...r, scrollToEnd };
}

describe('useComentarioSobreTeclado', () => {
  it('al enfocar el comentario baja hasta el final, y otra vez cuando abre el teclado', () => {
    const { result, scrollToEnd } = montar();

    act(() => { result.current.alEnfocarComentario(); });
    expect(scrollToEnd).toHaveBeenCalledTimes(1);

    act(() => { alMostrar!(); });
    expect(scrollToEnd).toHaveBeenCalledTimes(2);
  });

  it('un teclado que abre por OTRO campo no mueve el scroll', () => {
    const { scrollToEnd } = montar();
    act(() => { alMostrar!(); });
    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it('sólo reacciona a la primera apertura después de enfocar', () => {
    const { result, scrollToEnd } = montar();
    act(() => { result.current.alEnfocarComentario(); });
    act(() => { alMostrar!(); alMostrar!(); });
    expect(scrollToEnd).toHaveBeenCalledTimes(2);
  });

  it('suelta el listener del teclado al desmontar', () => {
    const { unmount } = montar();
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('sin scroll montado no rompe', () => {
    const r = renderHook(() => useComentarioSobreTeclado());
    expect(() => act(() => { r.result.current.alEnfocarComentario(); alMostrar?.(); })).not.toThrow();
  });
});
