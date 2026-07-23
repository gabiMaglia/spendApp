import { buildContactPayload, parseContactPayload, buildContactDeepLink } from '../contactLink';
import type { User } from '@/src/types/models';

const user = (over: Partial<User> = {}): User => ({
  id: 'u1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  authProvider: 'google',
  createdAt: 0,
  updatedAt: 0,
  isDeleted: false,
  ...over,
});

describe('contactLink', () => {
  it('roundtrip payload QR: build → parse conserva id/name/email', () => {
    const parsed = parseContactPayload(buildContactPayload(user()));
    expect(parsed).toEqual({ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' });
  });

  it('parse rechaza payloads sin el prefijo esperado', () => {
    expect(parseContactPayload('otra-cosa')).toBeNull();
    expect(parseContactPayload('{"id":"u1","name":"x"}')).toBeNull(); // JSON pero sin prefijo
  });

  it('parse rechaza JSON corrupto tras el prefijo', () => {
    expect(parseContactPayload('spendp2p:contact:{no-es-json')).toBeNull();
  });

  it('parse rechaza si falta id o name', () => {
    expect(parseContactPayload('spendp2p:contact:' + JSON.stringify({ name: 'x' }))).toBeNull();
    expect(parseContactPayload('spendp2p:contact:' + JSON.stringify({ id: 'u1' }))).toBeNull();
  });

  it('parse tolera email ausente (queda string vacío)', () => {
    const parsed = parseContactPayload('spendp2p:contact:' + JSON.stringify({ id: 'u1', name: 'Ada' }));
    expect(parsed).toEqual({ id: 'u1', name: 'Ada', email: '' });
  });

  it('deep link: incluye el scheme y codifica los params (espacios/acentos)', () => {
    const link = buildContactDeepLink(user({ name: 'José Pérez', email: 'jose@x.com' }));
    expect(link.startsWith('spendapp://contact/add?')).toBe(true);
    // URLSearchParams codifica los valores → un consumidor los decodifica bien
    const query = link.split('?')[1];
    const params = new URLSearchParams(query);
    expect(params.get('id')).toBe('u1');
    expect(params.get('name')).toBe('José Pérez');
    expect(params.get('email')).toBe('jose@x.com');
  });
});
