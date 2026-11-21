import { renderHook, act } from '@testing-library/react-native';
import { paginar, useActivityPagination, TAMANO_PAGINA } from '@/src/screens/activity/hooks/useActivityPagination';

const lista = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}` }));

describe('paginar', () => {
  it('75 ítems: 30 visibles y 45 restantes', () => {
    const r = paginar(lista(75), 30);
    expect(r.visibles).toHaveLength(30);
    expect(r.restantes).toBe(45);
  });
  it('60 → 15 restantes; 90 → 0 y todo visible', () => {
    expect(paginar(lista(75), 60).restantes).toBe(15);
    const r = paginar(lista(75), 90);
    expect(r.visibles).toHaveLength(75);
    expect(r.restantes).toBe(0);
  });
  it('30 o menos y vacío: sin restantes', () => {
    expect(paginar(lista(30), 30).restantes).toBe(0);
    expect(paginar([], 30)).toEqual({ visibles: [], restantes: 0 });
  });
});

describe('useActivityPagination', () => {
  it('verMas suma de a 30 hasta mostrar todo', () => {
    const items = lista(75);
    const { result } = renderHook(() => useActivityPagination(items, 'k'));
    expect(result.current.visibles).toHaveLength(TAMANO_PAGINA);
    expect(result.current.restantes).toBe(45);
    act(() => result.current.verMas());
    expect(result.current.visibles).toHaveLength(60);
    expect(result.current.restantes).toBe(15);
    act(() => result.current.verMas());
    expect(result.current.visibles).toHaveLength(75);
    expect(result.current.restantes).toBe(0);
  });
  it('cambiar la clave (filtro/búsqueda) vuelve a 30', () => {
    const items = lista(75);
    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => useActivityPagination(items, k), { initialProps: { k: 'a' } },
    );
    act(() => result.current.verMas());
    expect(result.current.visibles).toHaveLength(60);
    rerender({ k: 'b' });
    expect(result.current.visibles).toHaveLength(30);
  });
  it('un ítem lejano (70) queda fuera hasta pedir más', () => {
    const items = lista(75);
    const { result } = renderHook(() => useActivityPagination(items, 'k'));
    expect(result.current.visibles.some(i => i.id === 'e70')).toBe(false);
    act(() => result.current.verMas());
    act(() => result.current.verMas());
    expect(result.current.visibles.some(i => i.id === 'e70')).toBe(true);
  });
});
