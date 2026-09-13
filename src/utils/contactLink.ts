import type { User } from '@/src/types/models';
import { enlaceCompacto, enlaceCompartible, rutaDeEnlace } from '@/src/utils/appLink';
import { codificarContacto, decodificarContacto } from '@/src/utils/linkCompacto';

/**
 * Lo que viaja en el QR / link de contacto.
 *
 * Además de quién sos, lleva tu **secreto de contacto**: es lo que permite que
 * quien te escanee te deje su tarjeta y el contacto quede en LOS DOS teléfonos
 * con un solo escaneo (ver `src/sync/contactChannel.ts`). Sin él, el QR sigue
 * funcionando pero en una sola dirección — que es como funcionaba antes.
 */

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
  // Sin email a propósito (T-093 / SEC H-1): lo ve cualquiera que escanee el
  // código, y nadie del otro lado lo necesita para agregar el contacto.
  return QR_PREFIX + JSON.stringify({
    id: user.id,
    name: user.name,
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

/**
 * El link para compartir por mail o chat. Es `https` y no `spendapp://`: ver `utils/appLink`.
 */
export function buildContactDeepLink(user: User, keys?: ContactKeys | null): string {
  // Compacto si la regla lo puede representar sin pérdida; si no, el largo (`linkCompacto`).
  const codigo = codificarContacto({ id: user.id, name: user.name, ...(keys ?? {}) });
  if (codigo) return enlaceCompacto('c', codigo);

  // El fallback largo tampoco manda email, por la misma razón (T-093 / SEC H-1).
  const params = new URLSearchParams({ id: user.id, name: user.name });
  if (keys?.secret) params.set('s', keys.secret);
  if (keys?.wrapPublicKey) params.set('w', keys.wrapPublicKey);
  if (keys?.identityPublicKey) params.set('k', keys.identityPublicKey);
  return enlaceCompartible('contact/add', params);
}

/**
 * Un contacto desde parámetros ya parseados (los del router, o los de un link).
 *
 * Lleva las TRES claves. El parser anterior del link (`parseDeepLinkContact`, en la
 * pantalla) sólo leía el secreto: escanear el QR de un link dejaba al contacto sin su
 * pública de envoltura ni la de firma.
 */
export function contactFromParams(params: Record<string, unknown>): ContactPayload | null {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;
  // Formato compacto: todo viene en `c`, y manda sobre cualquier otro parámetro.
  const codigo = str(params.c);
  if (codigo !== undefined) return decodificarContacto(codigo);

  const id = str(params.id), name = str(params.name);
  if (!id || !name) return null;
  return {
    id, name,
    email: str(params.email) ?? '',
    secret:            str(params.s),
    wrapPublicKey:     str(params.w),
    identityPublicKey: str(params.k),
  };
}

/** Un contacto desde un link de la app, en su forma `https` o `spendapp://`. */
export function parseContactLink(url: string): ContactPayload | null {
  const r = rutaDeEnlace(url);
  if (!r || r.ruta !== 'contact/add') return null;
  return contactFromParams(Object.fromEntries(r.params.entries()));
}
