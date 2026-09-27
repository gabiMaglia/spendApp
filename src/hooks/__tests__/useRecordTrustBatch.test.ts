import { act, renderHook } from '@testing-library/react-native';
import { useRecordTrust } from '../useRecordTrust';
import { checkRecord } from '@/src/sync/trustCheck';
import type { Expense } from '@/src/types/models';

/**
 * **Un solo `setState` por ráfaga, no uno por firma** (T-153, causa medida en
 * `useVeredictos`).
 *
 * D8 (`useRecordTrust.test.ts`) ya prueba que la cola verifica de a una,
 * cediendo el hilo. Lo que este archivo agrega es la otra mitad del costo: con
 * ~300 filas por visita a Actividad, la implementación vieja hacía un
 * `setVeredictos` — y un re-render — por CADA una. Acá se cronometra con
 * timers falsos: `checkRecord` está mockeado para no firmar nada de verdad
 * pero avanzar el reloj falso los 37,57 ms medidos en el teléfono del PO por
 * cada llamada, así se puede observar el efecto de una ráfaga completa sin
 * esperar 11 segundos de test real.
 *
 * Por qué en un archivo aparte: mockear `trustCheck` global rompería todos los
 * tests de `useRecordTrust.test.ts` que verifican curva real (caché, edición,
 * fail-closed). Acá no importa la firma — importa el conteo de renders.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/contactChannel', () => ({ getPeer: () => undefined }));
jest.mock('@/src/sync/deviceKeys', () => ({ fetchAccountKeys: jest.fn(async () => []) }));

jest.mock('@/src/sync/trustCheck', () => ({
  checkRecord: jest.fn(() => {
    // `setSystemTime` mueve el reloj sin correr la cola de timers. Usar
    // `advanceTimersByTime`/`advanceTimersToNextTimer` ACÁ ADENTRO cascadea:
    // ese avance anidado, llamado desde dentro de un timer que YA está
    // corriendo como parte de otro `advanceTimers...` externo, dispara los
    // timers que se agendan DESPUÉS (el siguiente paso de la cola) dentro del
    // mismo tick anidado — los 300 pasos se ejecutan de un saque en el primer
    // `unPaso()`, y el test deja de medir nada.
    jest.setSystemTime(Date.now() + 37);
    return 'valida';
  }),
  checkVote: jest.fn(() => 'valida'),
}));

const checkRecordMock = checkRecord as jest.Mock;

const base = (over: Partial<Expense> = {}): Expense => ({
  id: 'e-1', groupId: 'g-1', description: 'Cena', amount: 10_000, currency: 'ARS',
  paidById: 'ana', splits: [{ userId: 'ana', amount: 10_000 }], splitMode: 'equal',
  category: 'food', date: 1, createdAt: 1, createdById: 'ana', deletionVotes: [],
  rev: 1_000, updatedAt: 9_000, isDeleted: false, ...over,
} as Expense);

/**
 * Un paso real: un `setTimeout(paso, 0)` por vez, cada uno en su propio
 * `act()`. Importa que sea uno por `act()` y no un `jest.runAllTimers()` en
 * uno solo: React 18 agrupa los `setState` de un mismo tramo síncrono, así que
 * meter los 300 pasos en un solo `act()` batchearía TODO — con la
 * implementación vieja también — y el test dejaría de distinguir nada. Un
 * `setTimeout` real es una macrotarea aparte; esto lo imita.
 */
const unPaso = () => act(() => { jest.advanceTimersToNextTimer(); });
const nPasos = (n: number) => { for (let i = 0; i < n; i++) unPaso(); };

beforeEach(() => {
  jest.useFakeTimers();
  checkRecordMock.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('V1 — un lote de setState, no uno por fila', () => {
  it('300 filas en la primera visita rinden muchos menos de 300 renders', () => {
    const gastos = Array.from({ length: 300 }, (_, i) => base({ id: `b${i}` }));
    let renders = 0;

    const { result, unmount } = renderHook(() => {
      renders++;
      return useRecordTrust('expense', gastos);
    });

    const montaje = renders;
    // Un paso por fila + uno de sobra para el volcado final de cola.
    nPasos(301);

    for (const g of gastos) expect(result.current[g.id]).toBe('verificado');
    expect(checkRecordMock).toHaveBeenCalledTimes(300);

    // La fórmula del plan: ceil(tiempo total / 100 ms) + 1, no 300.
    const tiempoTotalMs = 300 * 37;
    const techo = Math.ceil(tiempoTotalMs / 100) + 1;
    const rendersDeLaCola = renders - montaje;

    expect(rendersDeLaCola).toBeLessThanOrEqual(techo);
    expect(rendersDeLaCola).toBeLessThan(300);

    unmount();
  });
});

describe('V3 — editar durante una ráfaga no hereda el veredicto viejo', () => {
  it('el registro editado antes del primer volcado queda pendiente, no heredado', () => {
    const original = base({ id: 'e-1' });

    const { rerender, result } = renderHook<
      Readonly<Record<string, string>>, { lista: Expense[] }
    >(({ lista }) => useRecordTrust('expense', lista), { initialProps: { lista: [original] } });

    // Procesa el original: queda en el BUFFER, todavía sin volcar a estado
    // (una sola fila no llega a los 100 ms del umbral).
    unPaso();

    // Mismo id, otro monto: cambia la firma antes de que el buffer se vuelque.
    const editado = { ...original, amount: 55 } as Expense;
    rerender({ lista: [editado] });

    // Lo que ve la pantalla sale del estado comprometido, nunca del buffer:
    // la fila vuelve a `pendiente`, no arrastra el `valida` que quedó adentro
    // del buffer para una firma que ya no es la que está en pantalla.
    expect(result.current['e-1']).toBe('pendiente');

    nPasos(5);
    expect(result.current['e-1']).toBe('verificado');
  });
});

describe('V4 — desmontar a mitad de la ráfaga no dispara más setState', () => {
  it('ni verificaciones ni renders después de desmontar a mitad de cola', () => {
    const gastos = Array.from({ length: 50 }, (_, i) => base({ id: `m${i}` }));
    let renders = 0;

    const { unmount } = renderHook(() => {
      renders++;
      return useRecordTrust('expense', gastos);
    });

    nPasos(5);

    const llamadasAntes = checkRecordMock.mock.calls.length;
    const rendersAntes = renders;
    expect(llamadasAntes).toBeGreaterThan(0);
    expect(llamadasAntes).toBeLessThan(50);

    unmount();
    nPasos(50); // si algo sobreviviera al desmontaje, se notaría acá

    expect(checkRecordMock.mock.calls.length).toBe(llamadasAntes);
    expect(renders).toBe(rendersAntes);
  });
});

describe('Task 3 — el orden de la cola es el del feed (arriba primero)', () => {
  /**
   * `useActivityTrust`/`groups/[id]` arman el array ya ordenado —lo más
   * nuevo primero, `selectors.ts` lo ordena por `_ts`/fecha antes de llegar
   * acá— y la cola tiene que respetarlo: si reordenara, lo primero que ve el
   * usuario podría terminar siendo lo ÚLTIMO en verificarse. No hay
   * virtualización (T-154 queda para el PO), así que el único orden que
   * puede prometerse es el que trae el array de entrada.
   */
  it('verifica en el mismo orden en que llegan las filas, sin reordenar', () => {
    const gastos = Array.from({ length: 8 }, (_, i) => base({ id: `orden-${i}` }));

    renderHook(() => useRecordTrust('expense', gastos));
    nPasos(8);

    const idsVerificados = checkRecordMock.mock.calls.map(([, record]) =>
      (record as Expense).id);

    expect(idsVerificados).toEqual(gastos.map(g => g.id));
  });
});

describe('B1 (rechazo del verifier) — cambiar la clave a mitad de cola no pierde lo ya verificado', () => {
  /**
   * El bug: `hechos` (ref, sobrevive al efecto) marca una firma como hecha
   * ANTES de que su veredicto se vuelque al estado. Si `clave` cambia (llega
   * un registro nuevo al feed — el caso normal de Actividad, drenaje cada
   * 20 s) antes de que pasen los 100 ms del volcado, la limpieza del efecto
   * viejo tiraba el buffer sin volcarlo. El efecto nuevo arranca, filtra esas
   * firmas por `hechos` (ya "hechas") y nunca las vuelve a poner en cola: la
   * fila queda `pendiente` para siempre, aunque la verificación YA se hizo.
   */
  it('un registro nuevo a mitad de cola no deja las filas ya verificadas pendientes para siempre', () => {
    const gastos = Array.from({ length: 10 }, (_, i) => base({ id: `b${i}` }));

    const { rerender, result } = renderHook<
      Readonly<Record<string, string>>, { lista: Expense[] }
    >(({ lista }) => useRecordTrust('expense', lista), { initialProps: { lista: gastos } });

    // b0 y b1 procesados y en el buffer, sin volcar todavía (74 ms < 100 ms).
    nPasos(2);

    const nuevo = base({ id: 'b-nuevo' });
    rerender({ lista: [...gastos, nuevo] });

    nPasos(30);

    for (const g of [...gastos, nuevo]) {
      expect(result.current[g.id]).toBe('verificado');
    }

    // b0 y b1 no se verifican dos veces: `hechos` ya las tenía marcadas.
    const idsVerificados = checkRecordMock.mock.calls.map(([, record]) =>
      (record as Expense).id);
    expect(idsVerificados.filter(id => id === 'b0')).toHaveLength(1);
    expect(idsVerificados.filter(id => id === 'b1')).toHaveLength(1);
    expect(checkRecordMock).toHaveBeenCalledTimes(11); // 10 originales + 1 nuevo
  });
});
