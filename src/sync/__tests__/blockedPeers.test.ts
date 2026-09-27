import { isBlocked, block, unblock, blockedIds } from '../blockedPeers';
import { useAuthStore } from '@/src/store/authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

/**
 * T-180 (7.1): la lista de bloqueados, local y scoped por cuenta — mismo
 * mecanismo que `savePeer` (`contactChannel.ts`, bucket `users`). Tabla
 * B1/B6 del plan; B2-B5 se prueban donde bloquear tiene efecto
 * (`contactChannel.test.ts`, `groupKeyOffers.test.ts`, pantalla).
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

const ANA = { id: 'ana' } as User;
const BETO = { id: 'beto' } as User;

beforeEach(() => {
  createSecureStorage('users').clearAll();
  useAuthStore.setState({ currentUser: ANA });
});

describe('blockedPeers', () => {
  it('B1: bloquear a U marca isBlocked(U) true', () => {
    expect(isBlocked('u1')).toBe(false);
    block('u1');
    expect(isBlocked('u1')).toBe(true);
  });

  it('B1: persiste tras "remontar" (releer del storage, no sólo memoria)', () => {
    block('u1');
    // No hay estado en memoria en este módulo (a propósito, como `contactChannel`):
    // cada llamada relee el storage, así que "remontar" es simplemente volver a
    // preguntar.
    expect(blockedIds()).toContain('u1');
  });

  it('B1: scoped — otra cuenta no ve el bloqueo', () => {
    block('u1');
    useAuthStore.setState({ currentUser: BETO });
    expect(isBlocked('u1')).toBe(false);
    expect(blockedIds()).toEqual([]);
  });

  it('B5: desbloquear revierte isBlocked', () => {
    block('u1');
    unblock('u1');
    expect(isBlocked('u1')).toBe(false);
  });

  it('B6: usuario que actualiza sin lista previa — nada bloqueado por defecto', () => {
    expect(blockedIds()).toEqual([]);
    expect(isBlocked('cualquiera')).toBe(false);
  });

  it('bloquear no afecta a otros ids', () => {
    block('u1');
    expect(isBlocked('u2')).toBe(false);
  });
});
