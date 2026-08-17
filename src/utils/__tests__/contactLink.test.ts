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

describe('vínculo de contacto en AMBOS sentidos (T-031)', () => {
  const ana: User = {
    id: 'ua', name: 'Ana', email: 'ana@x.com', authProvider: 'google',
    createdAt: 0, updatedAt: 0, isDeleted: false,
  };
  const bob: User = {
    id: 'ub', name: 'Bob', email: 'bob@x.com', authProvider: 'apple',
    createdAt: 0, updatedAt: 0, isDeleted: false,
  };

  // El QR lleva UNA sola identidad: la del que lo muestra. Por eso escanear
  // deja el vínculo a medias y hace falta repetir el intercambio al revés.
  it('el código de Ana sólo identifica a Ana, nunca al que escanea', () => {
    const leido = parseContactPayload(buildContactPayload(ana));

    expect(leido?.id).toBe('ua');
    expect(JSON.stringify(leido)).not.toContain('ub');
  });

  it('el intercambio completo requiere los DOS códigos', () => {
    // Bob escanea a Ana: Bob tiene a Ana.
    const anaVistaPorBob = parseContactPayload(buildContactPayload(ana));
    // Ana escanea a Bob: recién ahí el vínculo queda completo.
    const bobVistoPorAna = parseContactPayload(buildContactPayload(bob));

    expect(anaVistaPorBob?.id).toBe('ua');
    expect(bobVistoPorAna?.id).toBe('ub');
  });

  it('el payload sobrevive el ida y vuelta con acentos y espacios', () => {
    const conAcentos: User = { ...ana, name: 'María José Ñandú' };
    expect(parseContactPayload(buildContactPayload(conAcentos))?.name).toBe('María José Ñandú');
  });

  it('un código propio escaneado por uno mismo se detecta como el mismo id', () => {
    const leido = parseContactPayload(buildContactPayload(ana));
    expect(leido?.id).toBe(ana.id); // la pantalla usa esto para no auto-agregarse
  });
});
