import { signCore } from '../recordSign';
import { forgetAuthorKeys, resolveAuthorKeys } from '../authorKeys';
import { clearVerdictCache } from '../verdictCache';
import { checkRecord } from '../trustCheck';
import { useAuthStore } from '@/src/store/authStore';
import { ensureIdentity } from '@/src/store/identityStore';
import type { Payment, User } from '@/src/types/models';

/**
 * T-170 · D-2 (dictamen del verificador, ronda de retorno 2). Un pago
 * legítimo del acreedor, firmado con su propia clave, quedaba `pendiente` en
 * cualquier aparato que todavía no resolvió su clave del directorio —
 * INCLUSO el propio, porque la pública propia sólo llegaba por
 * `resolveAuthorKeys` a través de `deviceKeys`/`contactChannel`
 * (`authorKeys.ts:216-228,358`), nunca de forma local. Con el borde ADR-004
 * (Apple sin email) el directorio nunca contesta: la degradación era
 * PERMANENTE.
 *
 * Fix: el contexto de verificación conoce SIEMPRE la pública de ESTE
 * aparato/cuenta quien firma como sí mismo — sin directorio, sin peer
 * registrado. `resolveAuthorKeys('yo')` la incluye; para cualquier OTRO
 * autor, la propia NO cuenta (si contara, cualquiera podría validar un
 * registro ajeno con SU firma).
 */

afterEach(() => {
  forgetAuthorKeys();
  clearVerdictCache();
  useAuthStore.setState({ currentUser: null });
});

describe('resolveAuthorKeys: la pública propia SIEMPRE se conoce para autoría propia', () => {
  it('esYo(authorId): la propia se incluye sin ninguna otra fuente', () => {
    useAuthStore.setState({ currentUser: { id: 'beto' } as User });
    const { publicKey } = ensureIdentity();
    expect(resolveAuthorKeys('beto')).toContain(publicKey);
  });

  it('mutante guard: un autor AJENO no se resuelve con la propia, aunque el que verifica sea este mismo aparato', () => {
    useAuthStore.setState({ currentUser: { id: 'beto' } as User });
    const { publicKey } = ensureIdentity();
    expect(resolveAuthorKeys('mallory')).not.toContain(publicKey);
  });

  it('sin sesión activa (esYo siempre false): no se agrega nada propio', () => {
    useAuthStore.setState({ currentUser: null });
    expect(resolveAuthorKeys('beto')).toEqual([]);
  });
});

describe('D-2 de punta a punta: un pago propio firmado verifica sin directorio', () => {
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
});
