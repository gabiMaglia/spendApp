import {
  codificarContacto, decodificarContacto, codificarInvitacion, decodificarInvitacion,
  aBase64Url, desdeBase64Url,
} from '@/src/utils/linkCompacto';
import type { ContactPayload } from '@/src/utils/contactLink';
import type { GroupInvite } from '@/src/sync/groupInvite';

/**
 * **La regla de compresión de los links** (PO, 2026-09-12).
 *
 * Sin servidor y sin acortador de terceros — un acortador guardaría el secreto de canal —,
 * el link se achica empaquetando en binario. Lo único que importa de verdad es que sea SIN
 * PÉRDIDA: un byte de una clave cambiado no da un contacto raro, da un contacto con el que
 * no se puede hablar nunca, y nadie lo atribuye al link.
 */

const hex = (n: number, semilla = 1) =>
  Array.from({ length: n }, (_, i) => ((i * 37 + semilla * 11) % 256).toString(16).padStart(2, '0')).join('');

const CLAVES = { secret: hex(32, 1), wrapPublicKey: hex(32, 2), identityPublicKey: hex(32, 3) };

describe('base64url', () => {
  it('ida y vuelta de cualquier largo, sin relleno ni caracteres que un cliente de mail corte', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n) % 256);
      const s = aBase64Url(bytes);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(Array.from(desdeBase64Url(s)!)).toEqual(Array.from(bytes));
    }
  });

  it('rechaza caracteres fuera del alfabeto y largos imposibles', () => {
    expect(desdeBase64Url('ab+c')).toBeNull();
    expect(desdeBase64Url('a')).toBeNull();
  });
});

describe('contacto', () => {
  const casos: [string, ContactPayload][] = [
    ['id de Google (número largo)', { id: '112233445566778899001', name: 'gabriel maglia', ...CLAVES }],
    ['id de Apple (texto con puntos)', { id: '001234.abcdef0123456789abcdef0123456789.1234', name: 'Ana', ...CLAVES }],
    ['id UUID', { id: '3f1c9a52-7b1e-4c0d-9a8e-2b6f1d3c4e5a', name: 'Beto', ...CLAVES }],
    ['nombre con acentos y emoji', { id: '42', name: 'José Pérez 🎉', ...CLAVES }],
    ['sin claves (código viejo)', { id: '42', name: 'Caro' }],
    ['sólo el secreto', { id: '42', name: 'Dani', secret: CLAVES.secret }],
  ];

  it.each(casos)('ida y vuelta SIN PÉRDIDA: %s', (_, contacto) => {
    const codigo = codificarContacto(contacto);
    expect(codigo).not.toBeNull();
    expect(codigo).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodificarContacto(codigo!)).toEqual({ email: '', ...contacto });
  });

  it('el mail NO viaja: no hace falta para agregar a nadie', () => {
    const codigo = codificarContacto({ id: '42', name: 'Ana', email: 'ana@x.com', ...CLAVES })!;
    expect(decodificarContacto(codigo)!.email).toBe('');
  });

  it('achica de verdad: el caso real de Google baja a menos de 170 caracteres', () => {
    const codigo = codificarContacto(casos[0][1])!;
    expect(codigo.length).toBeLessThan(170);
  });

  it('un id que empieza con 0 NO se trata como número: se perdería el cero', () => {
    const c = { id: '0123', name: 'Ana' };
    expect(decodificarContacto(codificarContacto(c)!)!.id).toBe('0123');
  });

  it('una clave que no es hex de 32 bytes no se comprime: devuelve null y se usa el link largo', () => {
    expect(codificarContacto({ id: '42', name: 'Ana', secret: 'ABCDEF' })).toBeNull();
    expect(codificarContacto({ id: '42', name: 'Ana', secret: hex(32).toUpperCase() })).toBeNull();
  });

  it('un nombre con UTF-16 roto no produce un código ilegible: cae al link largo', () => {
    // Un surrogate suelto pasa las validaciones de formato, pero sus bytes no son UTF-8
    // válido y el decodificador estricto los rechaza. El codificador decodifica lo que
    // produjo justamente para no entregar un código que después nadie puede leer.
    expect(codificarContacto({ id: '42', name: 'Ana\uD800' })).toBeNull();
    expect(codificarInvitacion({
      groupId: 'g1', groupName: 'X\uDC00', token: hex(32), inviterFingerprint: hex(16), expiresAt: 1,
    })).toBeNull();
  });

  it('sin nombre o sin id no hay contacto', () => {
    expect(codificarContacto({ id: '', name: 'Ana' })).toBeNull();
    expect(codificarContacto({ id: '42', name: '' })).toBeNull();
  });

  it('un código alterado o truncado no da un contacto: da null', () => {
    const codigo = codificarContacto(casos[0][1])!;
    expect(decodificarContacto(codigo.slice(0, 20))).toBeNull();
    expect(decodificarContacto('')).toBeNull();
    expect(decodificarContacto('###')).toBeNull();
  });

  it('una versión desconocida no se interpreta a ciegas', () => {
    const bytes = desdeBase64Url(codificarContacto(casos[0][1])!)!;
    bytes[0] = 99;
    expect(decodificarContacto(aBase64Url(bytes))).toBeNull();
  });
});

describe('invitación', () => {
  const inv = (over: Partial<GroupInvite> = {}): GroupInvite => ({
    groupId: '3f1c9a52-7b1e-4c0d-9a8e-2b6f1d3c4e5a',
    groupName: 'Año Nuevo en Córdoba',
    token: hex(32, 4),
    inviterFingerprint: hex(16, 5),
    expiresAt: 1_789_000_123_456,
    ...over,
  });

  it('ida y vuelta SIN PÉRDIDA, con el vencimiento al milisegundo', () => {
    expect(decodificarInvitacion(codificarInvitacion(inv())!)).toEqual(inv());
  });

  it('un id de grupo que no es UUID también viaja', () => {
    expect(decodificarInvitacion(codificarInvitacion(inv({ groupId: 'g1' }))!)).toEqual(inv({ groupId: 'g1' }));
  });

  it('achica de verdad: a menos del 70% de los parámetros del formato largo', () => {
    const i = inv();
    const largo = new URLSearchParams({
      g: i.groupId, n: i.groupName, t: i.token, f: i.inviterFingerprint, e: String(i.expiresAt),
    }).toString().length;
    expect(codificarInvitacion(i)!.length).toBeLessThan(largo * 0.7);
  });

  it('un token o una huella fuera de formato devuelve null y se usa el link largo', () => {
    expect(codificarInvitacion(inv({ token: 'corto' }))).toBeNull();
    expect(codificarInvitacion(inv({ inviterFingerprint: '' }))).toBeNull();
    expect(codificarInvitacion(inv({ expiresAt: 1.5 }))).toBeNull();
  });

  it('un código truncado da null', () => {
    expect(decodificarInvitacion(codificarInvitacion(inv())!.slice(0, 30))).toBeNull();
  });
});
