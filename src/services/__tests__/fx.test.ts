import { convertMinor, needsRates, isStale, refreshRates, readCache, type FxCache } from '../fx';

// Tasas reales de open.er-api.com (base USD) del 30/08/2026, recortadas.
const RATES: Record<string, number> = {
  USD: 1, EUR: 0.861542, ARS: 1513.0352, BRL: 5.164256,
  CLP: 925.290443, BOB: 11.547181, PYG: 5991.595128, UYU: 40.199456, PEN: 3.35366,
};
// T-124 · SEC L-C: `nextUpdateAt` real de la API superaba 24h por unos
// minutos (dato real del 30/08/2026); tras el tope de `refreshRates` el
// fixture representa lo que queda EN CACHE, ya recortado a 24h exactas.
const cache = (over: Partial<FxCache> = {}): FxCache => ({
  base: 'USD', rates: RATES, fetchedAt: 1_788_048_151_000, nextUpdateAt: 1_788_048_151_000 + 24 * 3600_000, ...over,
});

describe('convertMinor', () => {
  it('misma moneda: devuelve el mismo entero, sin pasar por la tasa', () => {
    // Importa que sea identidad EXACTA: si pasara por el redondeo, 1 centavo
    // podría moverse al convertir ARS→ARS, y eso sería plata inventada.
    expect(convertMinor(123456, 'ARS', 'ARS', cache())).toBe(123456);
  });

  it('misma moneda funciona aunque no haya cotizaciones', () => {
    expect(convertMinor(500, 'ARS', 'ARS', null)).toBe(500);
  });

  it('USD → BRL con 2 decimales de los dos lados', () => {
    // 100.00 USD × 5.164256 = 516.4256 BRL → 51643 en menor unidad
    expect(convertMinor(10_000, 'USD', 'BRL', cache())).toBe(51_643);
  });

  it('USD → CLP: el destino NO tiene decimales', () => {
    // 100 USD × 925.290443 = 92529.04 CLP → 92529 (entero, sin centavos)
    expect(convertMinor(10_000, 'USD', 'CLP', cache())).toBe(92_529);
  });

  it('PYG → ARS: el origen no tiene decimales y el destino sí', () => {
    // 1.000.000 ₲ ÷ 5991.595128 = 166.9007 USD × 1513.0352 = 252.512,3 ARS
    const r = convertMinor(1_000_000, 'PYG', 'ARS', cache());
    expect(r).toBe(Math.round((1_000_000 / 5991.595128) * 1513.0352 * 100));
  });

  it('cruza por USD sin necesitar el par directo: ARS → BRL', () => {
    const r = convertMinor(151_303_52, 'ARS', 'BRL', cache());
    expect(r).toBe(Math.round((15_130_352 / 100 / 1513.0352) * 5.164256 * 100));
  });

  it('sin cotizaciones devuelve null, NUNCA 0', () => {
    // Un 0 se sumaría al total como si el gasto no existiera. null obliga a
    // que la pantalla decida qué mostrar.
    expect(convertMinor(10_000, 'USD', 'ARS', null)).toBeNull();
  });

  it('moneda sin tasa devuelve null, NUNCA 0', () => {
    expect(convertMinor(10_000, 'USD', 'BOB', cache({ rates: { USD: 1 } }))).toBeNull();
  });

  it('tasa 0 o negativa se trata como ausente', () => {
    expect(convertMinor(10_000, 'USD', 'ARS', cache({ rates: { USD: 1, ARS: 0 } }))).toBeNull();
    expect(convertMinor(10_000, 'USD', 'ARS', cache({ rates: { USD: 1, ARS: -3 } }))).toBeNull();
  });

  it('monto 0 convierte a 0, no a null', () => {
    expect(convertMinor(0, 'USD', 'ARS', cache())).toBe(0);
  });

  it('montos negativos (ingresos/deudas) conservan el signo', () => {
    expect(convertMinor(-10_000, 'USD', 'BRL', cache())).toBe(-51_643);
  });
});

describe('needsRates — decision del PO: una sola moneda ⇒ CERO llamadas', () => {
  it('todo en una moneda y se muestra en esa: no pide nada', () => {
    expect(needsRates(['ARS', 'ARS', 'ARS'], 'ARS')).toBe(false);
  });

  it('sin datos todavia: no pide nada', () => {
    expect(needsRates([], 'ARS')).toBe(false);
  });

  it('una sola moneda en los datos pero se muestra en OTRA: si pide', () => {
    expect(needsRates(['ARS'], 'USD')).toBe(true);
  });

  it('dos monedas en los datos: si pide', () => {
    expect(needsRates(['ARS', 'BRL'], 'ARS')).toBe(true);
  });
});

describe('isStale — se respeta el nextUpdate que manda la propia API', () => {
  it('antes del proximo update: fresca', () => {
    expect(isStale(cache(), cache().nextUpdateAt - 1000)).toBe(false);
  });

  it('llegado el proximo update: vencida', () => {
    expect(isStale(cache(), cache().nextUpdateAt)).toBe(true);
  });

  it('sin cache: vencida', () => {
    expect(isStale(null, Date.now())).toBe(true);
  });

  it('si la API no mando nextUpdate, cae a un TTL de 12h desde fetchedAt', () => {
    const c = cache({ nextUpdateAt: 0 });
    expect(isStale(c, c.fetchedAt + 11 * 3600_000)).toBe(false);
    expect(isStale(c, c.fetchedAt + 13 * 3600_000)).toBe(true);
  });

  // T-124 · SEC L-C: una cache vieja (escrita antes del tope de `refreshRates`,
  // o directamente envenenada) con `nextUpdateAt` más de 24h después de
  // `fetchedAt` no se confía NUNCA, sin importar el reloj actual.
  it('un nextUpdateAt de más de 24h después de fetchedAt se trata como vencido siempre', () => {
    const DIEZ_ANOS = 10 * 365 * 24 * 3600_000;
    const envenenada = cache({ nextUpdateAt: cache().fetchedAt + DIEZ_ANOS });
    expect(isStale(envenenada, envenenada.fetchedAt + 1000)).toBe(true);
    expect(isStale(envenenada, envenenada.nextUpdateAt - 1000)).toBe(true);
  });
});

describe('refreshRates — lo que se escribe en cache (T-124 · SEC L-C)', () => {
  const NOW = 1_788_048_151_000;
  const mockFetch = (body: unknown, ok = true) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok, json: () => Promise.resolve(body),
    }) as unknown as typeof fetch;
  };

  it('un nextUpdateAt de 10 años (API envenenada) se recorta a 24h desde ahora', async () => {
    const DIEZ_ANOS_UNIX = Math.floor(NOW / 1000) + 10 * 365 * 24 * 3600;
    mockFetch({
      result: 'success', base_code: 'USD',
      rates: { ARS: 1000, USD: 1 },
      time_next_update_unix: DIEZ_ANOS_UNIX,
    });

    const r = await refreshRates(NOW);

    expect(r!.nextUpdateAt).toBe(NOW + 24 * 3600_000);
    expect(readCache()!.nextUpdateAt).toBe(NOW + 24 * 3600_000);
  });

  it('monedas no soportadas y tasas inválidas quedan afuera del cache', async () => {
    mockFetch({
      result: 'success', base_code: 'USD',
      rates: {
        ARS: 1000, USD: 1,
        XYZ: 5,          // no soportada por el proyecto
        BOB: 0,           // inválida: rateOk exige > 0
        PEN: -3,          // inválida
        UYU: Number.NaN,  // inválida
      },
      time_next_update_unix: 0,
    });

    const r = await refreshRates(NOW);

    expect(r!.rates).toEqual({ ARS: 1000, USD: 1 });
    expect(r!.rates.XYZ).toBeUndefined();
    expect(r!.rates.BOB).toBeUndefined();
  });
});
