import type { User } from '@/src/types/models';

const DEEP_LINK_SCHEME = 'spendapp://contact/add';
const QR_PREFIX = 'spendp2p:contact:';

export function buildContactPayload(user: User): string {
  return QR_PREFIX + JSON.stringify({ id: user.id, name: user.name, email: user.email });
}

export function parseContactPayload(raw: string): { id: string; name: string; email?: string } | null {
  if (!raw.startsWith(QR_PREFIX)) return null;
  try {
    const payload = JSON.parse(raw.slice(QR_PREFIX.length));
    if (!payload.id || !payload.name) return null;
    return { id: payload.id, name: payload.name, email: payload.email ?? '' };
  } catch {
    return null;
  }
}

export function buildContactDeepLink(user: User): string {
  const params = new URLSearchParams({ id: user.id, name: user.name, email: user.email });
  return `${DEEP_LINK_SCHEME}?${params.toString()}`;
}
