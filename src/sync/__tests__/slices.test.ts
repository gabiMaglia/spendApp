import * as Crypto from 'expo-crypto';
import { generateGroupKey } from '../envelopeCrypto';
import { deriveCkey, sliceEntities, TARGET_SLICE_BYTES } from '../slices';

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

describe('sliceEntities', () => {
  function gasto(id: string, relleno = ''): { id: string; relleno: string } {
    return { id, relleno };
  }

  it('lista vacía produce cero rebanadas', () => {
    expect(sliceEntities([])).toEqual([]);
  });

  it('una lista chica cabe en una sola rebanada', () => {
    const items = [gasto('a'), gasto('b'), gasto('c')];
    const slices = sliceEntities(items);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toEqual(items);
  });

  it('una lista grande se parte en varias rebanadas, cada una bajo el objetivo', () => {
    const relleno = 'x'.repeat(2_000);
    const items = Array.from({ length: 200 }, (_, i) => gasto(`e${i}`, relleno));
    const slices = sliceEntities(items);
    expect(slices.length).toBeGreaterThan(1);
    for (const slice of slices) {
      expect(JSON.stringify(slice).length).toBeLessThanOrEqual(TARGET_SLICE_BYTES * 1.05);
    }
    // ninguna entidad se pierde ni se duplica
    const idsDeVuelta = slices.flat().map(s => s.id).sort();
    expect(idsDeVuelta).toEqual(items.map(i => i.id).sort());
  });

  it('un solo elemento que ya supera el objetivo va solo en su rebanada, no se descarta', () => {
    const gigante = gasto('grande', 'x'.repeat(TARGET_SLICE_BYTES * 2));
    const items = [gasto('chico1'), gigante, gasto('chico2')];
    const slices = sliceEntities(items);
    const conElGigante = slices.find(s => s.some(i => i.id === 'grande'));
    expect(conElGigante).toHaveLength(1);
  });
});
