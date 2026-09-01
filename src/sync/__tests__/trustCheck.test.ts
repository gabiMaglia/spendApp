import { ed25519 } from '@noble/curves/ed25519.js';
import { checkRecord, checkVote } from '../trustCheck';
import { signCore } from '../recordSign';
import { signVote } from '../voteSign';
import { toHex } from '../hexBytes';
import { clearVerdictCache } from '../verdictCache';
import { observeRecord, recordStats, clearRecordHealth } from '../recordHealth';
import {
  forgetAuthorKeys, reloadAuthorKeys, rememberAuthorKey, pendingAuthorRefreshes,
  __resetAuthorSources,
} from '../authorKeys';
import { clearRatchet } from '../ratchet';
import type { DeletionVote, Expense, Payment } from '@/src/types/models';

/**
 * **El veredicto de una fila que se está mirando** (T-041 · S10).
 *
 * Es el camino de la MARCA, no el de la medición: acá no se cuenta nada, no se
 * mueve el trinquete y no se toca el detalle. Si mirar una pantalla moviera los
 * contadores de `recordHealth`, el único número que gobierna si la fase de
 * rechazo se enciende alguna vez pasaría a depender de cuánto scrolleó el PO —
 * y un contador así no es una métrica.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('../contactChannel', () => ({ getPeer: () => undefined }));
jest.mock('../deviceKeys', () => ({ fetchAccountKeys: jest.fn(async () => []) }));

const PRIV = toHex(new Uint8Array(32).fill(41));
const PUB  = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(41)));
const OTRA = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(7)));

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e-1', groupId: 'g-1', description: 'Cena', amount: 10_000, currency: 'ARS',
  paidById: 'ana', splits: [{ userId: 'ana', amount: 10_000 }], splitMode: 'equal',
  category: 'food', date: 1, createdAt: 1, createdById: 'ana', deletionVotes: [],
  rev: 1_000, updatedAt: 9_000, isDeleted: false, ...over,
} as Expense);

const firmado = (over: Partial<Expense> = {}): Expense => {
  const r = gasto(over);
  return { ...r, ...signCore('expense', r as never, PRIV) } as Expense;
};

beforeEach(() => {
  clearVerdictCache();
  clearRecordHealth();
  clearRatchet();
  forgetAuthorKeys();
  reloadAuthorKeys();
  __resetAuthorSources();
  rememberAuthorKey('ana', PUB);
});

describe('checkRecord', () => {
  it('firma que cierra y clave que es del autor declarado: `valida`', () => {
    expect(checkRecord('expense', firmado() as never)).toBe('valida');
  });

  it('firma real sobre un núcleo alterado después: `invalida`', () => {
    expect(checkRecord('expense', { ...firmado(), amount: 99_999 } as never)).toBe('invalida');
  });

  /**
   * Firmó una clave que no es de quien el registro dice ser. Sale gratis, sin
   * tocar la curva — es el mismo orden que usa el sobre: descartar barato antes
   * de la criptografía cara.
   */
  it('firmado con una clave ajena al autor: `invalida`', () => {
    rememberAuthorKey('beto', OTRA);
    const ajeno = firmado({ createdById: 'beto' });
    expect(checkRecord('expense', ajeno as never)).toBe('invalida');
  });

  /**
   * El histórico. Por R2 (opción A) no se re-firma nunca, así que esto va a
   * pasar para siempre — y **no es una acusación**.
   */
  it('sin firma: `no_verificable`', () => {
    expect(checkRecord('expense', gasto() as never)).toBe('no_verificable');
  });

  /**
   * Autor irresoluble. Pasa de verdad y por una limitación NUESTRA: el borde de
   * ADR-004 deja a quien entró por Apple sin `email` como otro `owner`, y
   * `account_keys` no lo encuentra. Es falta de información, no sospecha.
   */
  it('autor del que no tenemos ninguna clave: `no_verificable`', () => {
    expect(checkRecord('expense', firmado({ createdById: 'nadie' }) as never))
      .toBe('no_verificable');
  });

  /**
   * **Sin autor declarado no hay nada que atribuir.** Es el caso que un merge
   * mal formado o un peer roto puede producir, y la respuesta segura es «no
   * sé», nunca «está bien»: `valida` significa que la pública resuelve al autor
   * declarado, y acá no hay autor.
   */
  it('sin `createdById`: `no_verificable`, nunca `valida`', () => {
    const anonimo = { ...firmado(), createdById: '' };
    expect(checkRecord('expense', anonimo as never)).toBe('no_verificable');
  });

  /**
   * **D4: los que nadie puede firmar por diseño** — los pagos de absorción de
   * `applyLeave` y los gastos materializados de una plantilla. El device que los
   * crea no es el autor y no tiene con qué firmarlos.
   *
   * Tienen categoría propia y no se mezclan con el histórico. La razón no es
   * cosmética: **es la misma respuesta que da la medición para el mismo
   * registro** (`recordHealth.observeRecord`), y dos partes de la app que
   * clasifican distinto el mismo hecho es exactamente el tipo de incoherencia
   * que después nadie entiende. El test lo exige contra la medición real, no
   * contra una constante escrita a mano.
   */
  it('un gasto materializado: `no_firmable`, igual que en la medición', () => {
    const materializado = gasto({ id: 'rec_plantilla_777', date: 777, createdAt: 777 });

    expect(checkRecord('expense', materializado as never)).toBe('no_firmable');
    expect(observeRecord('expense', materializado as never)).toBe('no_firmable');
  });

  it('un pago de absorción de salida: `no_firmable`, igual que en la medición', () => {
    const pago = {
      id: 'leave:g-1:ana:500:0', groupId: 'g-1', fromUserId: 'ana', toUserId: 'beto',
      amount: 1_000, currency: 'ARS', date: 500, createdAt: 500, createdById: 'ana',
      updatedAt: 500, isDeleted: false,
    } as Payment;

    expect(checkRecord('payment', pago as never)).toBe('no_firmable');
    expect(observeRecord('payment', pago as never)).toBe('no_firmable');
  });
});

describe('checkVote', () => {
  const voto = (over: Partial<DeletionVote> = {}): DeletionVote => ({
    userId: 'ana', votedAt: 500, action: 'delete', roundId: 'r1', ...over,
  });
  const votoFirmado = (over: Partial<DeletionVote> = {}): DeletionVote => {
    const v = voto(over);
    return { ...v, ...signVote('e-1', v, PRIV) };
  };

  it('firmado por quien dice ser: `valida`', () => {
    expect(checkVote('e-1', votoFirmado())).toBe('valida');
  });

  it('sin firma: `no_verificable`', () => {
    expect(checkVote('e-1', voto())).toBe('no_verificable');
  });

  /**
   * La firma ata el enunciado a SU gasto. Sin eso, una objeción firmada valdría
   * para cualquier registro del grupo.
   */
  it('el mismo enunciado contra otro gasto: `invalida`', () => {
    expect(checkVote('e-OTRO', votoFirmado())).toBe('invalida');
  });

  it('firmado con la clave de otro: `invalida`', () => {
    rememberAuthorKey('beto', OTRA);
    const ajeno = voto({ userId: 'beto' });
    expect(checkVote('e-1', { ...ajeno, ...signVote('e-1', ajeno, PRIV) })).toBe('invalida');
  });

  it('votante del que no tenemos ninguna clave: `no_verificable`', () => {
    const suelto = voto({ userId: 'nadie' });
    expect(checkVote('e-1', { ...suelto, ...signVote('e-1', suelto, PRIV) }))
      .toBe('no_verificable');
  });
});

/**
 * **Mirar dispara la consulta al directorio.** Es la mitad que hace que la unión
 * de fuentes de S4 sirva de algo: `authorKeysFor` resuelve contra lo local
 * —síncrono, sin red— y **encola** la consulta para el próximo drenado.
 *
 * Sin esto, quien reinstala la app queda para siempre con su clave VIEJA en
 * nuestro registro local (`savePeerFromCard` sólo completa huecos, nunca
 * reemplaza) y sus registros nuevos no se verificarían nunca.
 */
describe('mirar una fila pide las claves que faltan', () => {
  it('un autor del que no sabemos nada queda encolado', () => {
    expect(pendingAuthorRefreshes()).toEqual([]);

    checkRecord('expense', firmado({ createdById: 'nuevo' }) as never);

    expect(pendingAuthorRefreshes()).toContain('nuevo');
  });

  /**
   * El caso de la reinstalación, que es el que la unión existe para arreglar:
   * del autor SÍ tenemos una clave, y no es la que firmó. Encolar sólo cuando no
   * sabemos nada dejaría este caso sin consultar nunca.
   */
  it('un autor conocido que presenta otra clave también queda encolado', () => {
    rememberAuthorKey('beto', OTRA);

    checkRecord('expense', firmado({ createdById: 'beto' }) as never);

    expect(pendingAuthorRefreshes()).toContain('beto');
  });

  it('un autor cuya clave ya cubre la firma no gasta una consulta', () => {
    checkRecord('expense', firmado() as never);

    expect(pendingAuthorRefreshes()).toEqual([]);
  });

  it('un voto de un votante desconocido también encola', () => {
    const v: DeletionVote = { userId: 'caro', votedAt: 1, action: 'delete' };
    checkVote('e-1', { ...v, ...signVote('e-1', v, PRIV) });

    expect(pendingAuthorRefreshes()).toContain('caro');
  });
});

/**
 * **Mirar no mide.** Es la separación que justifica que `trustCheck` exista al
 * lado de `recordHealth` en vez de reusarlo.
 */
describe('la marca no toca la medición', () => {
  it('verificar una fila no mueve ningún contador', () => {
    const antes = recordStats();

    checkRecord('expense', firmado() as never);
    checkRecord('expense', gasto() as never);
    checkVote('e-1', { userId: 'ana', votedAt: 1, action: 'delete' });

    expect(recordStats()).toEqual(antes);
  });
});
