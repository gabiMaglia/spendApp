import { toHex } from '../hexBytes';
import { signCore } from '../recordSign';
import { forgetAuthorKeys, resolveAuthorKeys } from '../authorKeys';
import { clearVerdictCache } from '../verdictCache';
import { checkRecord } from '../trustCheck';
import { useAuthStore } from '@/src/store/authStore';
import { ensureIdentity } from '@/src/store/identityStore';
import type { Payment, User } from '@/src/types/models';

/**
 * T-170 · D-2 (dictamen del verificador, rondas de retorno 2 y 3). Un pago
 * legítimo del acreedor, firmado con su propia clave, quedaba `pendiente` en
 * cualquier aparato que todavía no resolvió su clave del directorio —
 * INCLUSO el propio, porque la pública propia sólo llegaba por
 * `resolveAuthorKeys` a través de `deviceKeys`/`contactChannel`
 * (`authorKeys.ts:216-228,358`), nunca de forma local. Con el borde ADR-004
 * (Apple sin email) el directorio nunca contesta: la degradación era
 * PERMANENTE.
 *
 * **Ronda de retorno 3 (residual, es BUG no decisión del PO):** la primera
 * versión de este fix agregaba la propia AL MISMO array que decide "hay
 * clave conocida ⇒ o coincide (`valida`) o no (`invalida`)". Con eso, un
 * registro MÍO firmado desde OTRO aparato (o antes de reinstalar) pasaba de
 * `no_verificable` (antes del fix, directorio vacío) a `invalida` (con el
 * fix, porque ahora "hay una clave conocida" —la propia— y no coincide). La
 * propia sólo puede SUMAR `valida`; si no coincide y el directorio no
 * aportó nada, el veredicto tiene que seguir siendo `no_verificable`, como
 * antes de este fix — nunca una acusación nueva. `checkRecord`/`checkVote`
 * pasan a resolver en DOS pasos independientes (`conPropiaSoloParaValida`,
 * `authorKeys.ts`): primero SIN la propia (como siempre), y sólo si eso no
 * da `valida`, se intenta de nuevo SÓLO con la propia, y ese segundo intento
 * únicamente puede MEJORAR hacia `valida` — cualquier otro resultado se
 * descarta y queda el de siempre.
 */

afterEach(() => {
  forgetAuthorKeys();
  clearVerdictCache();
  useAuthStore.setState({ currentUser: null });
});

describe('resolveAuthorKeys: SIGUE siendo sólo peer/directorio (sin la propia)', () => {
  // La propia NO entra acá — si entrara, contaminaría el gate
  // "authorKeys.length===0 ⇒ no_verificable" de TODOS los consumidores que
  // resuelven así (`checkSettlement`, `recordHealth.observeRecord`,
  // `applyLeave`), que nunca pidieron el fix de D-2 y no lo necesitan.
  it('esYo(authorId) no alcanza para que resolveAuthorKeys la incluya', () => {
    useAuthStore.setState({ currentUser: { id: 'beto' } as User });
    const { publicKey } = ensureIdentity();
    expect(resolveAuthorKeys('beto')).not.toContain(publicKey);
  });
});

describe('D-2 de punta a punta: un pago propio firmado verifica sin directorio (checkRecord)', () => {
  const pago = (createdById: string, over: Partial<Payment> = {}): Payment => ({
    id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto', amount: 500_000,
    currency: 'ARS', date: 0, createdAt: 0, createdById, rev: 1, updatedAt: 0, isDeleted: false,
    ...over,
  } as Payment);

  it('el acreedor registra y firma su propio pago: el núcleo da `valida` sin conocer NINGUNA clave por fuera', () => {
    useAuthStore.setState({ currentUser: { id: 'beto' } as User });
    const { privateKey } = ensureIdentity();
    const base = pago('beto');
    const firmado = { ...base, ...signCore('payment', base as never, privateKey) } as Payment;

    expect(checkRecord('payment', firmado)).toBe('valida');
  });

  it('mutante guard: el mismo pago, pero declarado a nombre de OTRO (no yo), no verifica con mi propia clave', () => {
    useAuthStore.setState({ currentUser: { id: 'beto' } as User });
    const { privateKey } = ensureIdentity();
    const base = pago('mallory');
    const firmado = { ...base, ...signCore('payment', base as never, privateKey) } as Payment;

    expect(checkRecord('payment', firmado)).not.toBe('valida');
  });

  /**
   * Residual de la ronda de retorno 2, ahora bug cerrado. PoC del
   * orquestador: un registro MÍO, firmado en OTRO aparato de la MISMA
   * cuenta (una clave distinta de la de este aparato), sin que el
   * directorio haya aportado nada. Antes de este fix daba `no_verificable`;
   * con el fix de ronda 2 pasaba a `invalida` (regresión); acá tiene que
   * volver a `no_verificable`.
   */
  it('residual D-2 (BUG, no decisión del PO): un pago MÍO firmado desde OTRO aparato de la misma cuenta, sin directorio, da `no_verificable` — NUNCA `invalida`', () => {
    useAuthStore.setState({ currentUser: { id: 'beto' } as User });
    const PRIV_OTRO_APARATO = toHex(new Uint8Array(32).fill(42));
    const base = pago('beto');
    const firmadoEnOtroAparato = { ...base, ...signCore('payment', base as never, PRIV_OTRO_APARATO) } as Payment;

    expect(checkRecord('payment', firmadoEnOtroAparato)).toBe('no_verificable');
  });
});
