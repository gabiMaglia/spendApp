import { act, renderHook } from '@testing-library/react-native';
import { ed25519 } from '@noble/curves/ed25519.js';
import { useRecordTrust } from '../useRecordTrust';
import { signCore } from '@/src/sync/recordSign';
import { toHex } from '@/src/sync/hexBytes';
import { clearVerdictCache } from '@/src/sync/verdictCache';
import {
  forgetAuthorKeys, reloadAuthorKeys, rememberAuthorKey, __resetAuthorSources,
} from '@/src/sync/authorKeys';
import type { Expense } from '@/src/types/models';

/**
 * **Cuánto TRABAJA la cola, no cuánto cuesta la curva.**
 *
 * Archivo aparte porque necesita espiar `trustCheck`, y hacerlo en el archivo
 * grande cambiaría lo que miden sus 16 pruebas.
 *
 * Existe por un hueco que encontró una mutación del Orquestador: sacar el
 * registro de «lo ya resuelto» (`hechos`) **no tumbaba ningún test**. Y no era
 * por falta de pruebas de caché —hay tres— sino porque todas cuentan llamadas a
 * la CURVA, y la caché de veredictos (S3) absorbe la repetición un nivel más
 * abajo. O sea: la cola podía volver a recorrer todo en cada montaje y nadie se
 * enteraba.
 *
 * No es gratis que recorra de más: cada paso rehace la pre-imagen canónica,
 * consulta la caché y publica un veredicto que dispara un re-render.
 *
 * **Ojo con el alcance, que la primera versión de este test se equivocó:**
 * `hechos` es un `useRef`, así que NO sobrevive al desmontaje — lo que evita
 * repetir entre montajes es la caché de veredictos, y eso ya está probado en el
 * archivo grande. Lo que `hechos` protege es lo que pasa DENTRO de un montaje,
 * que es el caso real y frecuente: la lista visible cambia al scrollear, al
 * filtrar o al llegar un gasto nuevo por sync, y sin él cada cambio vuelve a
 * recorrer todo lo de antes.
 */
const contador = jest.fn();

jest.mock('@/src/sync/trustCheck', () => {
  const real = jest.requireActual('@/src/sync/trustCheck');
  return {
    ...real,
    checkRecord: (...args: unknown[]) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('./useRecordTrustCola.test') as { contador: jest.Mock }).contador();
      return (real.checkRecord as (...a: unknown[]) => unknown)(...args);
    },
  };
});

export { contador };

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/contactChannel', () => ({ getPeer: () => undefined }));
jest.mock('@/src/sync/deviceKeys', () => ({ fetchAccountKeys: jest.fn(async () => []) }));

const PRIV = toHex(new Uint8Array(32).fill(41));
const PUB  = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(41)));

function firmado(id = 'e-1'): Expense {
  const r = {
    id, groupId: 'g-1', description: 'Cena', amount: 10_000, currency: 'ARS',
    paidById: 'ana', splits: [{ userId: 'ana', amount: 10_000 }], splitMode: 'equal',
    category: 'food', date: 1, createdAt: 1, createdById: 'ana', deletionVotes: [],
    rev: 1_000, updatedAt: 9_000, isDeleted: false,
  } as unknown as Expense;
  return { ...r, ...signCore('expense', r as never, PRIV) } as Expense;
}

const laColaEntera = (tope = 50) => {
  for (let i = 0; i < tope; i++) act(() => { jest.advanceTimersToNextTimer(); });
};

beforeEach(() => {
  jest.useFakeTimers();
  contador.mockClear();
  clearVerdictCache();
  forgetAuthorKeys();
  reloadAuthorKeys();
  __resetAuthorSources();
  rememberAuthorKey('ana', PUB);
});

afterEach(() => { jest.useRealTimers(); });

describe('la cola no rehace lo que ya resolvió', () => {
  it('quitar una fila no hace recorrer de nuevo las que quedan', () => {
    // Pasa al scrollear, al filtrar y al archivar. Sin «lo ya resuelto», cada
    // cambio del conjunto visible vuelve a encolar todo lo de antes.
    const tres = [firmado('e-1'), firmado('e-2'), firmado('e-3')];
    const { rerender } = renderHook<Readonly<Record<string, unknown>>, { lista: Expense[] }>(
      ({ lista }) => useRecordTrust('expense', lista),
      { initialProps: { lista: tres } },
    );
    laColaEntera();
    expect(contador).toHaveBeenCalledTimes(3);

    rerender({ lista: tres.slice(0, 2) });
    laColaEntera();

    expect(contador).toHaveBeenCalledTimes(3);
  });

  it('agregar una fila sólo paga la fila nueva', () => {
    const dos = [firmado('e-1'), firmado('e-2')];
    const { rerender } = renderHook<Readonly<Record<string, unknown>>, { lista: Expense[] }>(
      ({ lista }) => useRecordTrust('expense', lista),
      { initialProps: { lista: dos } },
    );
    laColaEntera();
    expect(contador).toHaveBeenCalledTimes(2);

    rerender({ lista: [...dos, firmado('e-3')] });
    laColaEntera();

    expect(contador).toHaveBeenCalledTimes(3);
  });
});
