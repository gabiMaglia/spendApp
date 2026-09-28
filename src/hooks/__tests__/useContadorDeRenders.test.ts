import { renderHook } from '@testing-library/react-native';
import { useContadorDeRenders } from '@/src/hooks/useContadorDeRenders';
import { resumen, reset, setActivo } from '@/src/dev/contadorDeRenders';

/**
 * T-215: el hook cuenta en el CUERPO del render (sin `useEffect`, con un
 * `useRef`) y detecta qué dep cambió por `Object.is` contra el render
 * anterior — así el log puede decir "por qué" (qué store cambió), no sólo
 * "cuántas veces".
 */
describe('useContadorDeRenders', () => {
  beforeEach(() => {
    reset();
    setActivo(true);
  });

  afterEach(() => setActivo(false));

  it('cuenta un render por cada render del componente', () => {
    const { rerender } = renderHook(() => useContadorDeRenders('Prueba'));
    rerender({});
    rerender({});
    expect(resumen().find(f => f.nombre === 'Prueba')?.renders).toBe(3);
  });

  it('detecta qué dep cambió respecto del render anterior', () => {
    let deps = { users: 1, expenses: 1 };
    const { rerender } = renderHook(() => useContadorDeRenders('Prueba2', deps));

    deps = { users: 2, expenses: 1 }; // sólo users cambió
    rerender({});
    deps = { users: 2, expenses: 2 }; // sólo expenses cambió
    rerender({});

    const fila = resumen().find(f => f.nombre === 'Prueba2');
    expect(fila?.renders).toBe(3);
    expect(fila?.motivos).toEqual({ users: 1, expenses: 1 });
  });

  it('el primer render no reporta ningún motivo (no hay "anterior" con qué comparar)', () => {
    const deps = { users: 1 };
    renderHook(() => useContadorDeRenders('Prueba3', deps));
    const fila = resumen().find(f => f.nombre === 'Prueba3');
    expect(fila?.motivos).toEqual({});
  });

  it('sin deps, no registra ningún motivo nunca', () => {
    const { rerender } = renderHook(() => useContadorDeRenders('Prueba4'));
    rerender({});
    const fila = resumen().find(f => f.nombre === 'Prueba4');
    expect(fila?.renders).toBe(2);
    expect(fila?.motivos).toEqual({});
  });

  it('con el flag apagado, no registra nada', () => {
    setActivo(false);
    renderHook(() => useContadorDeRenders('Apagado'));
    expect(resumen().find(f => f.nombre === 'Apagado')).toBeUndefined();
  });

  it('resumen() agrega por nombre entre instancias distintas', () => {
    renderHook(() => useContadorDeRenders('Fila'));
    renderHook(() => useContadorDeRenders('Fila'));
    expect(resumen().find(f => f.nombre === 'Fila')?.renders).toBe(2);
  });
});
