import * as Crypto from 'expo-crypto';
import { generateGroupKey } from '../envelopeCrypto';
import { deriveCkey, sliceEntities, TARGET_SLICE_BYTES, MAX_SLICE_BYTES } from '../slices';

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

  /**
   * Revisión final, Fix 6 (menor): el tamaño se mide con `byteLength`
   * (UTF-8 real, `relay.ts`), no con `.length` (unidades UTF-16). Con
   * acentos, cada carácter pesa 2 bytes reales pero cuenta como 1 unidad
   * UTF-16 — con `.length` el objetivo se cruzaría muchísimo más tarde de lo
   * real, desalineando la contabilidad de rebanadas del límite que en
   * verdad importa (el mismo que aplica `relay.ts` sobre el payload final).
   */
  it('mide el tamaño en bytes UTF-8 reales, no en unidades UTF-16', () => {
    // Cada 'ñ' pesa 2 bytes en UTF-8 pero 1 unidad de `.length` — con la
    // medición vieja, este relleno "parecería" la mitad de pesado de lo que
    // realmente es.
    const relleno = 'ñ'.repeat(TARGET_SLICE_BYTES - 100);
    const items = [gasto('a', relleno), gasto('b', relleno), gasto('c', relleno)];
    const slices = sliceEntities(items);

    // Con `.length` (medición vieja), cada item "mediría" ~TARGET_SLICE_BYTES
    // - 100 y dos de ellos podrían convivir por debajo del objetivo. Medido
    // en bytes UTF-8 reales, cada uno YA excede el objetivo por sí solo, así
    // que cada uno cae en su propia rebanada.
    expect(slices).toHaveLength(3);
    for (const item of items) {
      const conEseItem = slices.find(s => s.some(i => i.id === item.id));
      expect(conEseItem).toHaveLength(1);
    }
  });

  /**
   * Revisión final, Fix 7 (menor): el plan siempre prometió que un elemento
   * que por sí solo supera `MAX_SLICE_BYTES` se manda "entero y señalado" —
   * pero nada lo señalaba. El aviso es un `console.warn`, nada más: no
   * cambia el comportamiento de partición (sigue yendo entero, solo, en su
   * propia rebanada), sólo agrega la trazabilidad que faltaba.
   */
  it('un elemento que supera MAX_SLICE_BYTES se avisa por consola, pero se manda igual, entero', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const gigante = gasto('elemento-grande', 'x'.repeat(MAX_SLICE_BYTES + 1));
    const slices = sliceEntities([gigante]);

    expect(slices).toEqual([[gigante]]); // se manda igual, entero — no se descarta ni se trunca
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('elemento-grande');

    warnSpy.mockRestore();
  });

  it('un elemento por debajo de MAX_SLICE_BYTES no dispara ningún aviso', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    sliceEntities([gasto('chico')]);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
