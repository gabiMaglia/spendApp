import * as Crypto from 'expo-crypto';
import { generateGroupKey } from '../envelopeCrypto';
import { deriveCkey } from '../slices';

describe('deriveCkey', () => {
  it('es determinística para la misma clave/tipo/seed', async () => {
    const key = generateGroupKey();
    const a = await deriveCkey(key, 'expenses', 'e1');
    const b = await deriveCkey(key, 'expenses', 'e1');
    expect(a).toBe(b);
  });

  it('cambia con el tipo, con el seed, o con la clave', async () => {
    const key = generateGroupKey();
    const base = await deriveCkey(key, 'expenses', 'e1');
    expect(await deriveCkey(key, 'payments', 'e1')).not.toBe(base);
    expect(await deriveCkey(key, 'expenses', 'e2')).not.toBe(base);
    expect(await deriveCkey(generateGroupKey(), 'expenses', 'e1')).not.toBe(base);
  });

  it('es hex de 64 caracteres (sha256)', async () => {
    const key = generateGroupKey();
    const ck = await deriveCkey(key, 'expenses', 'e1');
    expect(ck).toMatch(/^[0-9a-f]{64}$/);
  });
});
