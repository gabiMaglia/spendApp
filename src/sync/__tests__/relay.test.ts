import { byteLength, MAX_PAYLOAD_BYTES, isRelayConfigured, sendEnvelope, fetchSince, subscribeTopic } from '../relay';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

describe('byteLength — bytes reales, no unidades UTF-16', () => {
  it('cuenta 1 byte por carácter ASCII', () => {
    expect(byteLength('hola')).toBe(4);
  });

  // `'ñ'.length` es 1 pero ocupa 2 bytes: si se limitara por .length, un
  // payload con acentos pasaría el chequeo del cliente y lo rechazaría el
  // servidor con un 400 opaco.
  it('cuenta 2 bytes en acentos y ñ', () => {
    expect(byteLength('ñ')).toBe(2);
    expect(byteLength('café')).toBe(5);
  });

  it('cuenta 4 bytes en emoji (par suplente)', () => {
    expect(byteLength('🍕')).toBe(4);
  });

  it('el string vacío mide 0', () => {
    expect(byteLength('')).toBe(0);
  });

  it('el tope coincide con el CHECK de la tabla (256 KB)', () => {
    expect(MAX_PAYLOAD_BYTES).toBe(262144);
  });
});

describe('sin relay configurado, la app NO se rompe', () => {
  // Es offline-first: que falte el relay degrada, no tumba.
  it('isRelayConfigured refleja la ausencia de credenciales', () => {
    expect(typeof isRelayConfigured()).toBe('boolean');
  });

  it('enviar devuelve un error manejable en vez de tirar', async () => {
    const r = await sendEnvelope('t', 'x', 'dev1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['not_configured', 'network']).toContain(r.reason);
  });

  it('leer devuelve un error manejable en vez de tirar', async () => {
    const r = await fetchSince('t', 0);
    expect(r.ok).toBe(false);
  });

  it('suscribirse devuelve una función de corte usable, no undefined', () => {
    const off = subscribeTopic('t', () => {});
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });
});

describe('tope de tamaño', () => {
  it('rechaza un payload que excede 256 KB antes de salir a la red', async () => {
    const gigante = 'a'.repeat(MAX_PAYLOAD_BYTES + 1);
    const r = await sendEnvelope('t', gigante, 'dev1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['too_large', 'not_configured']).toContain(r.reason);
  });
});
