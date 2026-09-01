import { act, renderHook } from '@testing-library/react-native';
import { ed25519 } from '@noble/curves/ed25519.js';
import { useRecordTrust, useVoteTrust, voteRefKey } from '../useRecordTrust';
import { signCore } from '@/src/sync/recordSign';
import { signVote } from '@/src/sync/voteSign';
import { toHex } from '@/src/sync/hexBytes';
import { clearVerdictCache } from '@/src/sync/verdictCache';
import {
  forgetAuthorKeys, reloadAuthorKeys, rememberAuthorKey, __resetAuthorSources,
} from '@/src/sync/authorKeys';
import type { DeletionVote, Expense } from '@/src/types/models';

/**
 * **La verificación por fila visible** (T-041 · S10, decisión D8).
 *
 * El número que manda: **37,57 ms por verificación medidos en el teléfono del
 * PO** (banco de 20 en `/debug/identity`), 9,6× la laptop del §C.9 y 56× el
 * benchmark del README. De ahí sale todo lo que este hook hace y todo lo que se
 * niega a hacer:
 *
 *  - **no verifica durante el render** — 20 filas visibles serían 0,75 s de hilo
 *    bloqueado, y el usuario lo vería como la pantalla que no abre;
 *  - **va de a una y cede el hilo entre cada una**;
 *  - **se abandona** lo que salió de pantalla;
 *  - **una firma ya verificada no vuelve a tocar la curva nunca**.
 *
 * Los tres primeros se prueban con temporizadores falsos: si algo tocara la
 * curva antes de que corran, el espía lo delata. El cuarto, contando llamadas.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/contactChannel', () => ({ getPeer: () => undefined }));
jest.mock('@/src/sync/deviceKeys', () => ({ fetchAccountKeys: jest.fn(async () => []) }));

/** El espía delega en el real: acá se firma y se verifica de verdad. */
jest.mock('@noble/curves/ed25519.js', () => {
  const real = jest.requireActual('@noble/curves/ed25519.js');
  return {
    ...real,
    ed25519: {
      ...real.ed25519,
      verify: jest.fn((...args: unknown[]) => real.ed25519.verify(...args)),
    },
  };
});

const espia = ed25519.verify as unknown as jest.Mock;

/**
 * Un paso de la cola. Cada paso agenda el siguiente, así que `advanceToNextTimer`
 * corre exactamente uno — que es justamente lo que hay que poder observar.
 */
const unPaso = () => act(() => { jest.advanceTimersToNextTimer(); });

/** La cola entera. El tope evita colgarse si algún día se agenda en círculo. */
const laColaEntera = (tope = 50) => {
  for (let i = 0; i < tope; i++) unPaso();
};

const PRIV = toHex(new Uint8Array(32).fill(41));
const PUB  = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(41)));

const base = (over: Partial<Expense> = {}): Expense => ({
  id: 'e-1', groupId: 'g-1', description: 'Cena', amount: 10_000, currency: 'ARS',
  paidById: 'ana', splits: [{ userId: 'ana', amount: 10_000 }], splitMode: 'equal',
  category: 'food', date: 1, createdAt: 1, createdById: 'ana', deletionVotes: [],
  rev: 1_000, updatedAt: 9_000, isDeleted: false, ...over,
} as Expense);

/** Un gasto firmado de verdad por Ana, cuya clave el device ya conoce. */
function firmado(over: Partial<Expense> = {}): Expense {
  const r = base(over);
  return { ...r, ...signCore('expense', r as never, PRIV) } as Expense;
}

beforeEach(() => {
  jest.useFakeTimers();
  espia.mockClear();
  clearVerdictCache();
  forgetAuthorKeys();
  reloadAuthorKeys();
  __resetAuthorSources();
  rememberAuthorKey('ana', PUB);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('la verificación NO ocurre en el render', () => {
  /**
   * El caso que define D8. `renderHook` monta y corre los efectos dentro de
   * `act`, así que si la verificación estuviera en el render **o en el efecto**,
   * el espía ya tendría llamadas acá. Sólo aparecen al soltar los timers.
   */
  it('montar con filas firmadas no toca la curva ni una vez', () => {
    const gastos = Array.from({ length: 20 }, (_, i) => firmado({ id: `e${i}` }));

    const { result } = renderHook(() => useRecordTrust('expense', gastos));

    expect(espia).not.toHaveBeenCalled();
    expect(result.current['e0']).toBe('pendiente');
  });

  it('recién al ceder el hilo aparece el veredicto', () => {
    const gastos = [firmado()];
    const { result } = renderHook(() => useRecordTrust('expense', gastos));

    laColaEntera();

    expect(espia).toHaveBeenCalledTimes(1);
    expect(result.current['e-1']).toBe('verificado');
  });

  /**
   * Progresiva: **una por tick**, no las veinte de un saque. Un lote que
   * verificara todo junto en el primer timer cumpliría "no en el render" y
   * bloquearía el hilo 0,75 s igual — la mitad de la garantía.
   */
  it('va de a una: un tick, una verificación', () => {
    const gastos = Array.from({ length: 5 }, (_, i) => firmado({ id: `e${i}` }));
    renderHook(() => useRecordTrust('expense', gastos));

    unPaso();
    expect(espia).toHaveBeenCalledTimes(1);

    unPaso();
    expect(espia).toHaveBeenCalledTimes(2);
  });
});

describe('cancelable', () => {
  /**
   * «Si el usuario scrollea, lo que salió de pantalla se abandona» (D8). Acá se
   * prueba el caso extremo —la pantalla se cierra— porque es el que deja el
   * daño más caro: una cola que sobrevive al desmontaje sigue gastando 37 ms
   * por registro de una pantalla que ya no existe.
   */
  it('desmontar antes del primer tick no verifica nada', () => {
    const gastos = Array.from({ length: 10 }, (_, i) => firmado({ id: `e${i}` }));
    const { unmount } = renderHook(() => useRecordTrust('expense', gastos));

    unmount();
    laColaEntera();

    expect(espia).not.toHaveBeenCalled();
  });

  it('desmontar a la mitad abandona lo que faltaba', () => {
    const gastos = Array.from({ length: 10 }, (_, i) => firmado({ id: `e${i}` }));
    const { unmount } = renderHook(() => useRecordTrust('expense', gastos));

    unPaso();
    expect(espia).toHaveBeenCalledTimes(1);

    unmount();
    laColaEntera();

    expect(espia).toHaveBeenCalledTimes(1);
  });

  /**
   * **El caso que D8 nombra: el usuario scrollea.** Lo que salió de pantalla se
   * abandona a mitad de cola — no se termina «ya que estamos». Con 37 ms por
   * registro, terminar una lista que el usuario dejó atrás es tiempo de hilo
   * regalado, y en una lista larga es el grueso del costo.
   */
  it('cambiar el conjunto visible abandona lo que quedó afuera', () => {
    const primeros = Array.from({ length: 5 }, (_, i) => firmado({ id: `viejo${i}` }));
    const nuevos   = Array.from({ length: 2 }, (_, i) => firmado({ id: `nuevo${i}` }));

    const { rerender } = renderHook<
      Readonly<Record<string, string>>, { lista: Expense[] }
    >(
      ({ lista }) => useRecordTrust('expense', lista),
      { initialProps: { lista: primeros } },
    );

    unPaso();
    expect(espia).toHaveBeenCalledTimes(1);

    rerender({ lista: nuevos });
    laColaEntera();

    // 1 del conjunto viejo + los 2 nuevos. Sin abandono serían 7.
    expect(espia).toHaveBeenCalledTimes(3);
  });
});

describe('una firma ya verificada no se vuelve a verificar', () => {
  /**
   * La caché de veredictos (S3) deja de ser una optimización y pasa a ser LA
   * estructura (D8). Con el sobre trayendo el estado completo del grupo cada
   * 20 s, y el usuario volviendo a la misma pantalla, verificar por vista sería
   * pagar los 37 ms una y otra vez por la misma firma.
   */
  it('volver a montar la misma pantalla no toca la curva de nuevo', () => {
    const gastos = [firmado()];

    const primera = renderHook(() => useRecordTrust('expense', gastos));
    laColaEntera();
    expect(espia).toHaveBeenCalledTimes(1);
    primera.unmount();

    const segunda = renderHook(() => useRecordTrust('expense', gastos));
    laColaEntera();

    expect(espia).toHaveBeenCalledTimes(1);
    expect(segunda.result.current['e-1']).toBe('verificado');
  });

  /**
   * El mismo registro repetido en la lista tampoco: la cola se saltea lo que ya
   * resolvió, sin llegar siquiera a la caché.
   */
  it('el mismo registro dos veces en la lista se verifica una sola vez', () => {
    const g = firmado();
    renderHook(() => useRecordTrust('expense', [g, { ...g }]));

    laColaEntera();

    expect(espia).toHaveBeenCalledTimes(1);
  });

  /**
   * **Y el reverso, que es el que tiene filo:** el veredicto se guarda por
   * FIRMA, no por id. Si se guardara por id, un núcleo alterado después de que
   * lo verificamos heredaría el visto bueno de la versión anterior y la fila
   * mostraría «verificado» sobre un contenido que nadie firmó. Es el mismo
   * defecto que la caché de S3 ya había cerrado en su clave, un nivel más
   * arriba.
   */
  it('editar el registro le saca el visto bueno hasta volver a verificarlo', () => {
    const bueno = firmado();

    const { rerender, result } = renderHook<
      Readonly<Record<string, string>>, { lista: Expense[] }
    >(({ lista }) => useRecordTrust('expense', lista), { initialProps: { lista: [bueno] } });

    laColaEntera();
    expect(result.current['e-1']).toBe('verificado');

    // Mismo id, mismo `k`/`s`, otro monto: la firma de Ana ya no cierra.
    const alterado = { ...bueno, amount: 999_999 } as Expense;
    rerender({ lista: [alterado] });

    // Ni siquiera hace falta esperar a la cola: el visto bueno se cae solo.
    expect(result.current['e-1']).toBe('pendiente');

    laColaEntera();
    expect(result.current['e-1']).toBe('marcado');
  });
});

describe('los veredictos que no cuestan curva', () => {
  it('un registro sin firma queda marcado y no toca la curva', () => {
    const { result } = renderHook(() => useRecordTrust('expense', [base()]));

    laColaEntera();

    expect(result.current['e-1']).toBe('marcado');
    expect(espia).not.toHaveBeenCalled();
  });

  it('una firma que no cierra queda marcada', () => {
    const roto = { ...firmado(), amount: 99_999 } as Expense;
    const { result } = renderHook(() => useRecordTrust('expense', [roto]));

    laColaEntera();

    expect(result.current['e-1']).toBe('marcado');
  });

  /**
   * D4: los que nadie puede firmar por diseño. Un gasto materializado de una
   * plantilla recurrente también lleva marca — el copy neutro es literalmente
   * cierto para él y no marcarlo afirmaría una verificación que nadie hizo.
   */
  it('un gasto materializado queda marcado', () => {
    const materializado = base({ id: 'rec_t1_777', date: 777, createdAt: 777 });
    const { result } = renderHook(() => useRecordTrust('expense', [materializado]));

    laColaEntera();

    expect(result.current['rec_t1_777']).toBe('marcado');
  });
});

describe('los votos también se verifican por fila visible', () => {
  const voto = (over: Partial<DeletionVote> = {}): DeletionVote => ({
    userId: 'ana', votedAt: 500, action: 'delete', roundId: 'r1', ...over,
  });

  const votoFirmado = (over: Partial<DeletionVote> = {}): DeletionVote => {
    const v = voto(over);
    return { ...v, ...signVote('e-1', v, PRIV) };
  };

  it('un voto firmado por su autor no lleva marca, y tampoco en el render', () => {
    const v = votoFirmado();
    const { result } = renderHook(() => useVoteTrust([{ expenseId: 'e-1', vote: v }]));

    expect(espia).not.toHaveBeenCalled();

    laColaEntera();

    expect(result.current[voteRefKey('e-1', v)]).toBe('verificado');
  });

  it('un voto sin firma queda marcado', () => {
    const v = voto();
    const { result } = renderHook(() => useVoteTrust([{ expenseId: 'e-1', vote: v }]));

    laColaEntera();

    expect(result.current[voteRefKey('e-1', v)]).toBe('marcado');
  });

  /**
   * La firma del voto ata el enunciado a SU gasto. Una objeción firmada para
   * otro gasto no puede pasar por buena acá: sin eso, un voto valdría para
   * cualquier registro.
   */
  it('un voto firmado contra otro gasto queda marcado', () => {
    const v = votoFirmado();
    const { result } = renderHook(() => useVoteTrust([{ expenseId: 'e-OTRO', vote: v }]));

    laColaEntera();

    expect(result.current[voteRefKey('e-OTRO', v)]).toBe('marcado');
  });

  /**
   * Los votos de VARIOS gastos en una sola cola: es lo que necesita el feed de
   * actividad, donde cada fila de pedido o de restauración es de otro gasto. Un
   * hook por gasto sería un hook adentro de un bucle, que React no permite.
   */
  it('mezcla votos de gastos distintos sin confundirlos', () => {
    // El MISMO enunciado (misma persona, mismo instante) en dos gastos: si la
    // clave no llevara el gasto, los dos compartirían veredicto y el segundo
    // entraría gratis con el permiso del primero. Es la misma trampa que la
    // caché de S3 tuvo que cerrar, un nivel más arriba.
    const v = votoFirmado();
    const { result } = renderHook(() => useVoteTrust([
      { expenseId: 'e-1', vote: v },
      { expenseId: 'e-2', vote: v },   // firmado contra e-1, mostrado en e-2
    ]));

    laColaEntera();

    expect(result.current[voteRefKey('e-1', v)]).toBe('verificado');
    expect(result.current[voteRefKey('e-2', v)]).toBe('marcado');
  });
});
