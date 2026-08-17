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

describe('secreto de contacto en el código', () => {
  const yo = {
    id: 'u-ana', name: 'Ana', email: 'ana@test.com', authProvider: 'google' as const,
    createdAt: 0, updatedAt: 0, isDeleted: false,
  };
  const SECRETO = 'ab'.repeat(32);

  // Sin el secreto adentro, el QR vuelve a ser de UNA dirección: el que lo
  // muestra nunca se entera de quién lo escaneó. Es todo el punto de la feature.
  it('EL QR LLEVA EL SECRETO Y SE RECUPERA AL LEERLO', () => {
    const leido = parseContactPayload(buildContactPayload(yo, { secret: SECRETO }));
    expect(leido?.secret).toBe(SECRETO);
  });

  it('el link de contacto también lo lleva', () => {
    expect(buildContactDeepLink(yo, { secret: SECRETO })).toContain(`s=${SECRETO}`);
  });

  it('sin secreto el código sigue siendo válido, pero de una sola dirección', () => {
    const leido = parseContactPayload(buildContactPayload(yo));
    expect(leido?.id).toBe('u-ana');
    expect(leido?.secret).toBeUndefined();
  });

  // Códigos generados por una versión anterior tienen que seguir andando.
  it('un código viejo sin secreto se lee igual', () => {
    const viejo = 'spendp2p:contact:' + JSON.stringify({ id: 'u-x', name: 'Equis', email: '' });
    expect(parseContactPayload(viejo)).toMatchObject({ id: 'u-x', name: 'Equis' });
  });
});

describe('claves públicas en el código', () => {
  const yo = {
    id: 'u-ana', name: 'Ana', email: 'ana@test.com', authProvider: 'google' as const,
    createdAt: 0, updatedAt: 0, isDeleted: false,
  };
  const CLAVES = {
    secret: 'ab'.repeat(32),
    wrapPublicKey: 'cd'.repeat(32),
    identityPublicKey: 'ef'.repeat(32),
  };

  // Sin la pública de envoltura no se le puede mandar nada dirigido SOLO a esta
  // persona: la clave de su buzón la conoce todo el que haya escaneado el mismo
  // código, así que dejar ahí una clave de grupo se la daría a todos ellos.
  it('EL QR LLEVA LA PÚBLICA DE ENVOLTURA', () => {
    expect(parseContactPayload(buildContactPayload(yo, CLAVES))?.wrapPublicKey)
      .toBe(CLAVES.wrapPublicKey);
  });

  // Sin la de firma no se puede verificar que lo que llega sea realmente suyo.
  it('EL QR LLEVA LA PÚBLICA DE FIRMA', () => {
    expect(parseContactPayload(buildContactPayload(yo, CLAVES))?.identityPublicKey)
      .toBe(CLAVES.identityPublicKey);
  });

  it('el link de contacto lleva las tres', () => {
    const link = buildContactDeepLink(yo, CLAVES);
    expect(link).toContain(`s=${CLAVES.secret}`);
    expect(link).toContain(`w=${CLAVES.wrapPublicKey}`);
    expect(link).toContain(`k=${CLAVES.identityPublicKey}`);
  });
});
