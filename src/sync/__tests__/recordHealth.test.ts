import { ed25519 } from '@noble/curves/ed25519.js';
import {
  observeRecord, observeRecords, recordStats, unverifiableBreakdown,
  invalidRecords, verifyCost, benchmarkVerify,
  clearRecordHealth, reloadRecordHealth, RECORD_HEALTH_KEY,
} from '../recordHealth';
import { signCore } from '../recordSign';
import { clearVerdictCache, verdictCacheSize } from '../verdictCache';
import { forgetAuthorKeys, reloadAuthorKeys, refreshPendingAuthors, __resetAuthorSources } from '../authorKeys';
import { authorRatchet, clearRatchet } from '../ratchet';
import { toHex } from '../hexBytes';
import { EXPENSE, PAYMENT } from '@/src/test-utils/recordFixtures';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

/**
 * S6 de T-041: **la medición**.
 *
 * Tres reglas gobiernan este archivo:
 *
 *  1. **Se marca, no se rechaza** (R1). Acá sólo se cuenta; que nada deje de
 *     aplicarse lo prueba `mergeGate.test.ts`.
 *  2. **Cuatro números, no tres** (D4). Los tres veredictos no se negocian y el
 *     cuarto —`no_firmable`— no puede contaminar a ninguno de ellos ni al revés.
 *  3. **Una clave stale no puede producir `invalida`** (D2). Es la restricción
 *     que decide si el criterio de cierre («`invalida` sostenido en 0 con
 *     `valida` > 0») puede alcanzarse alguna vez.
 */

const mockGetPeer = jest.fn();
jest.mock('../contactChannel', () => ({
  getPeer: (userId: string) => mockGetPeer(userId),
}));

const mockFetchAccountKeys = jest.fn();
jest.mock('../deviceKeys', () => ({
  fetchAccountKeys: (accountId: string) => mockFetchAccountKeys(accountId),
}));

const storage = createSecureStorage('users');

function par(seed: number) {
  const priv = new Uint8Array(32).fill(seed);
  return { priv: toHex(priv), pub: toHex(ed25519.getPublicKey(priv)) };
}

/** El teléfono de Ana. */
const ANA = par(31);
/** El que se compró después de reinstalar. Sólo el directorio lo conoce. */
const ANA_NUEVA = par(32);
/** El de un impostor. */
const MALO = par(33);

const gastoDeAna = (extra: Record<string, unknown> = {}) => ({
  ...EXPENSE, createdById: 'ana', ...extra,
});

/** Un gasto de Ana firmado con la clave que se le pase. */
function firmadoPor(quien: { priv: string }, extra: Record<string, unknown> = {}) {
  const nucleo = gastoDeAna(extra);
  return { ...nucleo, ...signCore('expense', nucleo as never, quien.priv) };
}

/** Un gasto anterior a T-041: sin `k`, sin `s`, sin `rev`. */
function sinFirmar(extra: Record<string, unknown> = {}) {
  const r = gastoDeAna(extra) as Record<string, unknown>;
  delete r.k; delete r.s; delete r.rev;
  return r;
}

const sesion = (id: string) => useAuthStore.setState({ currentUser: { id } as User });

/** El registro local de peers conoce esta clave de Ana (fuente 1). */
const peerConClave = (pub?: string) =>
  mockGetPeer.mockImplementation(() => (pub ? { secret: 's', identityPublicKey: pub } : undefined));

beforeEach(() => {
  sesion('cuenta-a');
  clearRecordHealth();
  clearVerdictCache();
  clearRatchet();
  forgetAuthorKeys();
  reloadAuthorKeys();
  __resetAuthorSources();
  mockGetPeer.mockReset();
  mockFetchAccountKeys.mockReset();
  peerConClave(undefined);
  mockFetchAccountKeys.mockResolvedValue([]);
});

const CEROS = { valida: 0, invalida: 0, no_verificable: 0, no_firmable: 0 };

describe('los cuatro contadores se mueven POR SEPARADO', () => {
  it('`valida`: firma que verifica y clave que resuelve al autor declarado', () => {
    peerConClave(ANA.pub);
    expect(observeRecord('expense', firmadoPor(ANA) as never)).toBe('valida');
    expect(recordStats()).toEqual({ ...CEROS, valida: 1 });
  });

  it('`no_verificable`: un registro anterior a T-041, que no trae firma', () => {
    peerConClave(ANA.pub);
    expect(observeRecord('expense', sinFirmar() as never)).toBe('no_verificable');
    expect(recordStats()).toEqual({ ...CEROS, no_verificable: 1 });
  });

  it('`no_verificable`: firma buena de un autor que todavía no podemos resolver', () => {
    expect(observeRecord('expense', firmadoPor(ANA) as never)).toBe('no_verificable');
    expect(recordStats()).toEqual({ ...CEROS, no_verificable: 1 });
  });

  it('`invalida`: la firma no cierra contra la clave del propio autor', () => {
    peerConClave(ANA.pub);
    const roto = { ...firmadoPor(ANA), amount: 999 };
    expect(observeRecord('expense', roto as never)).toBe('invalida');
    expect(recordStats()).toEqual({ ...CEROS, invalida: 1 });
  });

  it('`no_firmable`: el pago de absorción que ningún device puede firmar', () => {
    peerConClave(ANA.pub);
    const pago = {
      ...PAYMENT, id: 'leave:g-1:beto:4500:0', groupId: 'g-1', createdById: 'beto',
      k: undefined, s: undefined,
    };
    expect(observeRecord('payment', pago as never)).toBe('no_firmable');
    expect(recordStats()).toEqual({ ...CEROS, no_firmable: 1 });
  });

  it('los cuatro juntos: cada entrada cae en el suyo y en ninguno más', () => {
    peerConClave(ANA.pub);
    observeRecord('expense', firmadoPor(ANA) as never);
    observeRecord('expense', sinFirmar({ id: 'e-viejo' }) as never);
    observeRecord('expense', { ...firmadoPor(ANA, { id: 'e-roto' }), amount: 7 } as never);
    observeRecord('payment', {
      ...PAYMENT, id: 'leave:g-1:beto:4500:0', groupId: 'g-1', createdById: 'beto',
      k: undefined, s: undefined,
    } as never);

    expect(recordStats()).toEqual({ valida: 1, no_verificable: 1, invalida: 1, no_firmable: 1 });
  });
});

describe('D4 · `no_firmable` no contamina a `no_verificable` NI AL REVÉS', () => {
  it('un registro pre-T-041 cuenta `no_verificable`, no `no_firmable`', () => {
    peerConClave(ANA.pub);
    observeRecord('expense', sinFirmar() as never);
    expect(recordStats().no_firmable).toBe(0);
    expect(recordStats().no_verificable).toBe(1);
  });

  it('un pago de salida no cuenta `no_verificable` aunque no traiga firma', () => {
    observeRecord('payment', {
      ...PAYMENT, id: 'leave:g-1:beto:4500:0', groupId: 'g-1', createdById: 'beto',
      k: undefined, s: undefined,
    } as never);
    expect(recordStats().no_verificable).toBe(0);
  });

  /**
   * El prefijo derivado no es una amnistía: si el registro TRAE firma, se
   * verifica como cualquier otro. Si no, alcanzaría con ponerle el id para
   * salirse de la medición.
   */
  it('un registro con id derivado pero FIRMADO se verifica como cualquier otro', () => {
    peerConClave(ANA.pub);
    const materializado = firmadoPor(ANA, {
      id: 'rec_r-1_1700000000000', date: 1_700_000_000_000, createdAt: 1_700_000_000_000,
    });
    expect(observeRecord('expense', materializado as never)).toBe('valida');
    expect(recordStats().no_firmable).toBe(0);
  });
});

describe('D2 · una clave stale NO puede producir `invalida`', () => {
  /**
   * Ana reinstaló. Su clave vieja quedó pegada en nuestro registro local, así
   * que `authorKeys` NO está vacío: tiene una clave, la equivocada. Sin D2 el
   * veredicto sería el acusatorio, y cada reinstalación legítima envenenaría el
   * único número que gobierna si el rechazo se enciende alguna vez.
   */
  it('clave vieja + refresh todavía sin respuesta ⇒ `no_verificable`', () => {
    peerConClave(ANA.pub);
    expect(observeRecord('expense', firmadoPor(ANA_NUEVA) as never)).toBe('no_verificable');
    expect(recordStats().invalida).toBe(0);
  });

  it('y dispara la consulta al directorio, que es lo que lo arregla', async () => {
    peerConClave(ANA.pub);
    observeRecord('expense', firmadoPor(ANA_NUEVA) as never);

    mockFetchAccountKeys.mockResolvedValue([ANA_NUEVA.pub]);
    await refreshPendingAuthors();

    expect(observeRecord('expense', firmadoPor(ANA_NUEVA, { id: 'e-2' }) as never)).toBe('valida');
  });

  /**
   * El otro lado de la moneda: si D2 se llevara puesto el veredicto acusatorio
   * para siempre, `invalida` sería un contador muerto y la suplantación
   * dejaría de verse. Recién cuando el directorio contestó SOBRE ESA CLAVE y
   * siguió sin cubrirla, hay señal.
   */
  it('cuando el directorio ya contestó y la clave sigue afuera ⇒ `invalida`', async () => {
    peerConClave(ANA.pub);
    observeRecord('expense', firmadoPor(MALO) as never);        // encola la consulta
    await refreshPendingAuthors();                              // el directorio contesta vacío

    expect(observeRecord('expense', firmadoPor(MALO, { id: 'e-2' }) as never)).toBe('invalida');
  });

  it('un directorio caído nunca convierte un corte de red en una acusación', async () => {
    peerConClave(ANA.pub);
    observeRecord('expense', firmadoPor(MALO) as never);
    mockFetchAccountKeys.mockRejectedValue(new Error('sin red'));
    await refreshPendingAuthors();

    expect(observeRecord('expense', firmadoPor(MALO, { id: 'e-2' }) as never)).toBe('no_verificable');
  });

  /**
   * D2 no puede tapar una firma rota. Acá la clave presentada SÍ es de Ana: no
   * hay nada viejo en nuestro juego de claves, la firma simplemente no cierra.
   */
  it('una firma que no verifica contra la clave propia del autor sigue siendo `invalida`', () => {
    peerConClave(ANA.pub);
    expect(observeRecord('expense', { ...firmadoPor(ANA), amount: 1 } as never)).toBe('invalida');
  });
});

describe('el trinquete y lo que aporta a la lectura', () => {
  it('una firma válida traba el trinquete del autor', () => {
    peerConClave(ANA.pub);
    observeRecord('expense', firmadoPor(ANA) as never);
    expect(authorRatchet('ana')).toBe('firma');
  });

  it('un registro sin firma no traba nada', () => {
    peerConClave(ANA.pub);
    observeRecord('expense', sinFirmar() as never);
    expect(authorRatchet('ana')).toBe('desconocido');
  });

  /**
   * El caso que de verdad ejercita la condición: la clave presentada SÍ es de
   * Ana, se llegó hasta la curva, y la curva dijo que no. Si el trinquete se
   * trabara igual, "vimos firmar a este autor" pasaría a significar "vimos algo
   * que decía ser de él" — y el denominador de la medición se llenaría de
   * autores que nunca firmaron nada válido.
   */
  it('una firma que llega a la curva y NO cierra tampoco traba el trinquete', () => {
    peerConClave(ANA.pub);
    expect(observeRecord('expense', { ...firmadoPor(ANA), amount: 1 } as never)).toBe('invalida');
    expect(authorRatchet('ana')).toBe('desconocido');
  });

  /**
   * Lo que el trinquete aporta a la medición: parte los `no_verificable` en dos
   * poblaciones que significan cosas distintas. Un registro sin firma de un
   * autor que NUNCA firma es el histórico; uno sin firma de un autor que firma
   * el resto es lo que hay que ir a mirar.
   */
  it('los `no_verificable` se reportan partidos por posición del trinquete', () => {
    peerConClave(ANA.pub);
    observeRecord('expense', firmadoPor(ANA) as never);            // traba a ana
    observeRecord('expense', sinFirmar({ id: 'e-2' }) as never);   // ana, ya trabada
    observeRecord('expense', sinFirmar({ id: 'e-3', createdById: 'zoe' }) as never);

    expect(unverifiableBreakdown()).toEqual({ desconocido: 1, firma: 1 });
    expect(recordStats().no_verificable).toBe(2);
  });

  /**
   * La razón por la que el trinquete NO promueve `invalida` cuando un autor
   * que firma manda algo sin firma: por R2 el histórico no se re-firma, así que
   * eso pasa todo el tiempo con gente honesta.
   */
  it('un autor trabado en `firma` que manda un registro viejo NO suma `invalida`', () => {
    peerConClave(ANA.pub);
    observeRecord('expense', firmadoPor(ANA) as never);
    observeRecord('expense', sinFirmar({ id: 'e-viejo' }) as never);
    expect(recordStats().invalida).toBe(0);
  });
});

describe('el orden del §C.9: descarte por `rev` → caché → curva', () => {
  it('un `rev` que no supera al local se descarta SIN tocar la curva', () => {
    peerConClave(ANA.pub);
    const entrante = { ...firmadoPor(ANA), rev: 50, amount: 999 };  // firma rota, además

    expect(observeRecord('expense', entrante as never, { rev: 100 })).toBe('omitido');
    expect(recordStats()).toEqual(CEROS);
    expect(verifyCost().ops).toBe(0);
  });

  it('un `rev` igual al local tampoco compite: se descarta', () => {
    peerConClave(ANA.pub);
    const r = firmadoPor(ANA, { rev: 100 });
    expect(observeRecord('expense', r as never, { rev: 100 })).toBe('omitido');
    expect(verifyCost().ops).toBe(0);
  });

  it('un `rev` mayor sí se verifica', () => {
    peerConClave(ANA.pub);
    const r = firmadoPor(ANA, { rev: 200 });
    expect(observeRecord('expense', r as never, { rev: 100 })).toBe('valida');
    expect(verifyCost().ops).toBe(1);
  });

  it('un registro que este device no tiene se verifica aunque no traiga `rev`', () => {
    peerConClave(ANA.pub);
    expect(observeRecord('expense', sinFirmar() as never, undefined)).toBe('no_verificable');
    expect(recordStats().no_verificable).toBe(1);
  });

  it('la caché evita la curva la segunda vez que llega la misma firma', () => {
    peerConClave(ANA.pub);
    const r = firmadoPor(ANA);

    expect(observeRecord('expense', r as never)).toBe('valida');
    expect(observeRecord('expense', r as never)).toBe('valida');

    expect(verifyCost().ops).toBe(1);          // una sola vez se pagó la curva
    expect(recordStats().valida).toBe(2);      // pero las dos recepciones se contaron
  });
});

describe('`observeRecords` recorre la lista con el estado local a mano', () => {
  it('cuenta lo nuevo y omite lo que ya tenemos igual o más nuevo', () => {
    peerConClave(ANA.pub);
    const nuevo = firmadoPor(ANA, { id: 'e-nuevo', rev: 300 });
    const viejo = firmadoPor(ANA, { id: 'e-viejo', rev: 10 });

    observeRecords('expense', [nuevo, viejo] as never[], id =>
      (id === 'e-viejo' ? { rev: 99 } : undefined));

    expect(recordStats()).toEqual({ ...CEROS, valida: 1 });
  });

  it('un registro sin autor declarado es `no_verificable`, no una excepción', () => {
    observeRecords('expense', [{ ...sinFirmar(), createdById: '' }] as never[], () => undefined);
    expect(recordStats()).toEqual({ ...CEROS, no_verificable: 1 });
  });
});

describe('el detalle de los `invalida`, que es lo que se va a mirar', () => {
  it('se guarda por autor y grupo, con contador y no N filas iguales', async () => {
    peerConClave(ANA.pub);
    observeRecord('expense', firmadoPor(MALO) as never);
    await refreshPendingAuthors();
    observeRecord('expense', firmadoPor(MALO, { id: 'e-2' }) as never);
    observeRecord('expense', firmadoPor(MALO, { id: 'e-3' }) as never);

    const detalle = invalidRecords();
    expect(detalle).toHaveLength(1);
    expect(detalle[0]).toMatchObject({ groupId: 'g-1', authorId: 'ana', count: 2 });
  });
});

describe('la medición sobrevive al reinicio y no cruza cuentas', () => {
  it('los contadores siguen ahí después de recargar de disco', () => {
    peerConClave(ANA.pub);
    observeRecord('expense', firmadoPor(ANA) as never);

    reloadRecordHealth();
    expect(recordStats()).toEqual({ ...CEROS, valida: 1 });
  });

  it('dos cuentas del mismo teléfono no comparten contadores', () => {
    peerConClave(ANA.pub);
    observeRecord('expense', firmadoPor(ANA) as never);

    sesion('cuenta-b');
    reloadRecordHealth();
    expect(recordStats()).toEqual(CEROS);

    sesion('cuenta-a');
    reloadRecordHealth();
    expect(recordStats()).toEqual({ ...CEROS, valida: 1 });
  });

  it('un dato corrupto arranca de cero en vez de romper el sync', () => {
    peerConClave(ANA.pub);
    observeRecord('expense', firmadoPor(ANA) as never);
    storage.set(`${RECORD_HEALTH_KEY}::u:cuenta-a`, 'esto no es JSON');

    reloadRecordHealth();
    expect(recordStats()).toEqual(CEROS);
  });
});

describe('el costo, que es el gate S6→S7', () => {
  it('mide lo que costó verificar de verdad, no lo que costó la caché', () => {
    peerConClave(ANA.pub);
    observeRecord('expense', firmadoPor(ANA) as never);
    const c = verifyCost();
    expect(c.ops).toBe(1);
    expect(c.msPorOp).not.toBeNull();
  });

  it('sin una sola verificación no inventa un promedio', () => {
    expect(verifyCost()).toMatchObject({ ops: 0, msPorOp: null });
  });

  /**
   * El banco tiene que medir **la curva**, no la caché. Si pasara por el camino
   * cacheado, de la segunda iteración en adelante estaría cronometrando un
   * `Map.get` y el número que decide el gate S6→S7 sería ~20 veces optimista.
   */
  it('el banco de pruebas devuelve un ms/op, no toca la medición real ni la caché', () => {
    const msPorOp = benchmarkVerify(3);
    expect(msPorOp).toBeGreaterThan(0);
    expect(recordStats()).toEqual(CEROS);
    expect(verifyCost().ops).toBe(0);
    expect(verdictCacheSize()).toBe(0);
  });
});

describe('observar no puede romper el sync', () => {
  it('una fuente de claves que explota deja el veredicto en `no_verificable`', () => {
    mockGetPeer.mockImplementation(() => { throw new Error('storage roto'); });
    expect(() => observeRecord('expense', firmadoPor(ANA) as never)).not.toThrow();
    expect(recordStats().no_verificable).toBe(1);
  });
});
