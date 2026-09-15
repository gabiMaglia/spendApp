import { buildContactPayload, parseContactPayload, parseContactLink } from '../contactLink';
import { ENLACE_BASE } from '@/src/utils/appLink';
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
  // T-093 / SEC H-1: el QR/link propio ya no manda el email — nadie del otro
  // lado lo necesita, y viajaba a cualquiera que lo escaneara o abriera el
  // link. Antes de este ticket, `parsed.email` traía el mail real.
  it('roundtrip payload QR: build → parse conserva id/name, y NO manda el email', () => {
    const parsed = parseContactPayload(buildContactPayload(user()));
    expect(parsed).toEqual({ id: 'u1', name: 'Ada Lovelace', email: '' });
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

  // T-102 (PO, 2026-09-13): el Pages personal del PO se apaga — esa copia
  // vieja de la página ve los secretos del link. Deja de leerse, aunque el
  // link sea por lo demás válido. El formato LARGO nuevo (sobre
  // `spendapp.github.io`) se sigue aceptando, probado abajo.
  it('los links del Pages personal viejo (gabimaglia) ya NO se leen (T-102), con .html y sin él', () => {
    const q = 'id=u1&name=Jos%C3%A9&email=j%40x.com&s=' + 'ab'.repeat(32);
    const viejas = [
      'https://gabimaglia.github.io/spendApp/web/abrir.html',
      'https://gabimaglia.github.io/spendApp/web/abrir',
    ];
    for (const base of viejas) {
      expect(parseContactLink(`${base}#contact/add?${q}`)).toBeNull();
    }
  });

  it('el link LARGO sobre la base nueva (spendapp.github.io) se sigue leyendo', () => {
    const q = 'id=u1&name=Jos%C3%A9&email=j%40x.com&s=' + 'ab'.repeat(32);
    const leido = parseContactLink(`${ENLACE_BASE}#contact/add?${q}`);
    expect(leido?.name).toBe('José');
    expect(leido?.email).toBe('j@x.com');
    expect(leido?.secret).toBe('ab'.repeat(32));
  });

  it('link de otra pantalla no es un contacto', () => {
    expect(parseContactLink('spendapp://groups/join?id=u1&name=Ada')).toBeNull();
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
  // T-124 · SEC L-B: `esIdDeCuenta` exige al menos un dígito (forma real de
  // Google/Apple/UUID); 'u-ana' era sólo un valor de prueba cómodo.
  const yo = {
    id: 'u-ana1', name: 'Ana', email: 'ana@test.com', authProvider: 'google' as const,
    createdAt: 0, updatedAt: 0, isDeleted: false,
  };
  const SECRETO = 'ab'.repeat(32);

  // Sin el secreto adentro, el QR vuelve a ser de UNA dirección: el que lo
  // muestra nunca se entera de quién lo escaneó. Es todo el punto de la feature.
  it('EL QR LLEVA EL SECRETO Y SE RECUPERA AL LEERLO', () => {
    const leido = parseContactPayload(buildContactPayload(yo, { secret: SECRETO }));
    expect(leido?.secret).toBe(SECRETO);
  });

  it('sin secreto el código sigue siendo válido, pero de una sola dirección', () => {
    const leido = parseContactPayload(buildContactPayload(yo));
    expect(leido?.id).toBe('u-ana1');
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
    id: 'u-ana1', name: 'Ana', email: 'ana@test.com', authProvider: 'google' as const,
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

});

describe('formato largo validado (T-098 · SEC L-2)', () => {
  const H = 'ab'.repeat(32);
  const largo = (q: string) => `spendapp://contact/add?${q}`;

  it('una clave que no es hex de 32 bytes invalida el link', () => {
    expect(parseContactLink(largo(`id=u1&name=Ada&s=not-hex`))).toBeNull();
    expect(parseContactLink(largo(`id=u1&name=Ada&w=..%2F..%2F`))).toBeNull();
    expect(parseContactLink(largo(`id=u1&name=Ada&k=${'ab'.repeat(31)}`))).toBeNull();
  });

  it('las claves en mayúsculas siguen valiendo (respaldo largo del compacto)', () => {
    expect(parseContactLink(largo(`id=u1&name=Ada&s=${'AB'.repeat(32)}`))?.secret).toBe('AB'.repeat(32));
  });

  it('un nombre hostil invalida el link', () => {
    expect(parseContactLink(largo(`id=u1&name=${encodeURIComponent('evil‮txt')}&s=${H}`))).toBeNull();
  });

  it('un id de más de 255 bytes invalida el link', () => {
    expect(parseContactLink(largo(`id=${'i'.repeat(256)}&name=Ada`))).toBeNull();
  });

  // T-124 · SEC L-B: antes sólo se topaba con el tope de 255 bytes.
  it('un id sin forma (NUL, traversal, sin dígito) invalida el link', () => {
    expect(parseContactLink(largo(`id=${encodeURIComponent('a b')}&name=Ada`))).toBeNull();
    expect(parseContactLink(largo(`id=${encodeURIComponent('../x1')}&name=Ada`))).toBeNull();
    expect(parseContactLink(largo(`id=__proto__&name=Ada`))).toBeNull(); // sin dígito
  });
});
