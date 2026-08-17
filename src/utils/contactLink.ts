import type { User } from '@/src/types/models';

/**
 * Lo que viaja en el QR / link de contacto.
 *
 * Además de quién sos, lleva tu **secreto de contacto**: es lo que permite que
 * quien te escanee te deje su tarjeta y el contacto quede en LOS DOS teléfonos
 * con un solo escaneo (ver `src/sync/contactChannel.ts`). Sin él, el QR sigue
 * funcionando pero en una sola dirección — que es como funcionaba antes.
 */

const DEEP_LINK_SCHEME = 'spendapp://contact/add';
const QR_PREFIX = 'spendp2p:contact:';

export type ContactPayload = {
  id: string;
  name: string;
  email?: string;
  /** Ausente en códigos viejos: se tolera y se degrada a una sola dirección. */
  secret?: string;
};

export function buildContactPayload(user: User, secret?: string | null): string {
  return QR_PREFIX + JSON.stringify({
    id: user.id,
    name: user.name,
    email: user.email,
    ...(secret ? { s: secret } : {}),
  });
}

export function parseContactPayload(raw: string): ContactPayload | null {
  if (!raw.startsWith(QR_PREFIX)) return null;
  try {
    const payload = JSON.parse(raw.slice(QR_PREFIX.length));
    if (!payload.id || !payload.name) return null;
    return {
      id: payload.id,
      name: payload.name,
      email: payload.email ?? '',
      secret: typeof payload.s === 'string' ? payload.s : undefined,
    };
  } catch {
    return null;
  }
}

export function buildContactDeepLink(user: User, secret?: string | null): string {
  const params = new URLSearchParams({ id: user.id, name: user.name, email: user.email });
  if (secret) params.set('s', secret);
  return `${DEEP_LINK_SCHEME}?${params.toString()}`;
}
