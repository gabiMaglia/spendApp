import {
  avatarByteSize, avatarCabe, AVATAR_MAX_BYTES, achicarAAvatar,
  claveDeFallo, elegirAvatarDeGaleria, type FalloAvatar,
} from '../avatar';

const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...a: unknown[]) => mockManipulate(...a),
  SaveFormat: { JPEG: 'jpeg' },
}));
const mockPermiso = jest.fn();
const mockGaleria = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: () => mockPermiso(),
  launchImageLibraryAsync: () => mockGaleria(),
}));

const b64 = (bytes: number) => Buffer.alloc(bytes, 1).toString('base64');

beforeEach(() => {
  mockManipulate.mockReset();
  mockPermiso.mockReset().mockResolvedValue({ granted: true });
  mockGaleria.mockReset().mockResolvedValue({ canceled: true });
});

describe('tamaño', () => {
  it('mide los bytes REALES, no el largo del base64', () => {
    // base64 infla ~4/3: confundirlos dejaría pasar imagenes un tercio mas
    // pesadas de lo que el tope permite.
    expect(avatarByteSize(`data:image/jpeg;base64,${b64(3_000)}`)).toBe(3_000);
  });

  it('descuenta el relleno "=" del final', () => {
    expect(avatarByteSize(`data:image/jpeg;base64,${b64(3_001)}`)).toBe(3_001);
    expect(avatarByteSize(`data:image/jpeg;base64,${b64(3_002)}`)).toBe(3_002);
  });

  it('acepta base64 pelado, sin el prefijo data:', () => {
    expect(avatarByteSize(b64(500))).toBe(500);
  });

  it('lo que entra en el tope pasa; lo que no, no', () => {
    expect(avatarCabe(`data:image/jpeg;base64,${b64(AVATAR_MAX_BYTES)}`)).toBe(true);
    expect(avatarCabe(`data:image/jpeg;base64,${b64(AVATAR_MAX_BYTES + 1)}`)).toBe(false);
  });
});

describe('achicarAAvatar', () => {
  it('devuelve un data URI cuando la imagen entra', async () => {
    mockManipulate.mockResolvedValue({ base64: b64(5_000) });
    const r = await achicarAAvatar('file://foto.jpg');
    expect(r).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('achica a un cuadrado fijo, no al tamaño original', async () => {
    mockManipulate.mockResolvedValue({ base64: b64(5_000) });
    await achicarAAvatar('file://foto.jpg');
    const [, acciones] = mockManipulate.mock.calls[0];
    expect(acciones[0].resize).toEqual({ width: 96, height: 96 });
  });

  it('si AUN achicada no entra, devuelve null y no la original', async () => {
    // Preferible quedarse sin foto que arrastrar un peso desconocido en cada
    // sobre: la tarjeta de contacto viaja en TODOS los syncs.
    mockManipulate.mockResolvedValue({ base64: b64(AVATAR_MAX_BYTES + 5_000) });
    expect(await achicarAAvatar('file://enorme.jpg')).toBeNull();
  });

  it('sin base64 en la respuesta devuelve null', async () => {
    mockManipulate.mockResolvedValue({});
    expect(await achicarAAvatar('file://x.jpg')).toBeNull();
  });

  it('si el procesamiento explota NO se rompe nada: se sigue con iniciales', async () => {
    mockManipulate.mockRejectedValue(new Error('formato raro'));
    await expect(achicarAAvatar('file://roto.heic')).resolves.toBeNull();
  });
});


describe('claveDeFallo', () => {
  it('cancelar NO produce mensaje: el usuario decidió, no falló nada', () => {
    expect(claveDeFallo('cancelado')).toBeNull();
  });

  it('todo fallo REAL tiene un mensaje propio, y ninguno se repite', () => {
    // El defecto que este código corrige era mostrar lo mismo (o nada) ante
    // causas distintas: el usuario no puede saber si reintentar sirve.
    const reales: FalloAvatar[] = ['sin_permiso', 'sin_modulo', 'no_procesable'];
    const claves = reales.map(claveDeFallo);
    expect(claves.every(c => typeof c === 'string' && c.length > 0)).toBe(true);
    expect(new Set(claves).size).toBe(reales.length);
  });
});

describe('elegirAvatarDeGaleria', () => {
  it('sin permiso: lo dice, y NO abre la galería', async () => {
    mockPermiso.mockResolvedValue({ granted: false });
    expect(await elegirAvatarDeGaleria()).toEqual({ ok: false, motivo: 'sin_permiso' });
    expect(mockGaleria).not.toHaveBeenCalled();
  });

  it('cancelar se distingue de fallar', async () => {
    mockGaleria.mockResolvedValue({ canceled: true });
    expect(await elegirAvatarDeGaleria()).toEqual({ ok: false, motivo: 'cancelado' });
  });

  it('imagen que no se puede procesar ⇒ no_procesable, no cancelado', async () => {
    mockGaleria.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://x.jpg' }] });
    mockManipulate.mockRejectedValue(new Error('formato raro'));
    expect(await elegirAvatarDeGaleria()).toEqual({ ok: false, motivo: 'no_procesable' });
  });

  it('caso feliz: devuelve el data URI', async () => {
    mockGaleria.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://x.jpg' }] });
    mockManipulate.mockResolvedValue({ base64: b64(5_000) });
    const r = await elegirAvatarDeGaleria();
    expect(r.ok).toBe(true);
    expect(r.ok && r.dataUri).toMatch(/^data:image\/jpeg;base64,/);
  });
});

describe('build sin el módulo nativo (el bug del 31/08)', () => {
  // El APK del PO era anterior a que `expo-image-manipulator` entrara al
  // proyecto. La galería abría, elegía la foto, y no pasaba NADA: el fallo se
  // reportaba igual que "esa imagen no se pudo procesar", así que el usuario
  // probaba con otra foto para siempre.
  it('se reporta como sin_modulo, NO como no_procesable', async () => {
    jest.resetModules();
    jest.doMock('expo-image-manipulator', () => {
      throw new Error("Cannot find native module 'ExpoImageManipulator'");
    });
    jest.doMock('expo-image-picker', () => ({
      requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
      launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'file://x.jpg' }] }),
    }));
    const mod = require('../avatar');
    expect(mod.manipuladorDisponible()).toBe(false);
    expect(await mod.elegirAvatarDeGaleria()).toEqual({ ok: false, motivo: 'sin_modulo' });
    jest.resetModules();
  });
});
