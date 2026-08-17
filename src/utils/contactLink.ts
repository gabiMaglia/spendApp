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

export type ContactKeys = {
  /** Secreto de contacto: su buzón. Ausente en códigos viejos. */
  secret?: string;
  /** X25519 de su dispositivo: a ella se le envuelven las claves de grupo. */
  wrapPublicKey?: string;
  /** Ed25519 de su dispositivo: con ella se verifica lo que mande después. */
  identityPublicKey?: string;
};

export type ContactPayload = ContactKeys & {
  id: string;
  name: string;
  email?: string;
};

/**
 * Las públicas van en el código junto con el secreto. Sin ellas, quien escanea
 * podría escribirle a esta persona pero no mandarle nada dirigido SOLO a ella:
 * la clave del buzón la conoce todo el que haya escaneado ese mismo código.
 */
export function buildContactPayload(user: User, keys?: ContactKeys | null): string {
  return QR_PREFIX + JSON.stringify({
    id: user.id,
    name: user.name,
    email: user.email,
    ...(keys?.secret ? { s: keys.secret } : {}),
    ...(keys?.wrapPublicKey ? { w: keys.wrapPublicKey } : {}),
    ...(keys?.identityPublicKey ? { k: keys.identityPublicKey } : {}),
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
      secret:            typeof payload.s === 'string' ? payload.s : undefined,
      wrapPublicKey:     typeof payload.w === 'string' ? payload.w : undefined,
      identityPublicKey: typeof payload.k === 'string' ? payload.k : undefined,
    };
  } catch {
    return null;
  }
}

export function buildContactDeepLink(user: User, keys?: ContactKeys | null): string {
  const params = new URLSearchParams({ id: user.id, name: user.name, email: user.email });
  if (keys?.secret) params.set('s', keys.secret);
  if (keys?.wrapPublicKey) params.set('w', keys.wrapPublicKey);
  if (keys?.identityPublicKey) params.set('k', keys.identityPublicKey);
  return `${DEEP_LINK_SCHEME}?${params.toString()}`;
}
