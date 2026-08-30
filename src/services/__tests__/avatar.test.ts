import { avatarByteSize, avatarCabe, AVATAR_MAX_BYTES, achicarAAvatar } from '../avatar';

const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...a: unknown[]) => mockManipulate(...a),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  launchImageLibraryAsync: async () => ({ canceled: true }),
}));

const b64 = (bytes: number) => Buffer.alloc(bytes, 1).toString('base64');

beforeEach(() => mockManipulate.mockReset());

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
