import { formatMoney, hasDecimals, minorFactor, parseMoney, setFormatLanguage } from '../currencies';

describe('minorFactor', () => {
  it('returns 100 for currencies with 2 decimals', () => {
    expect(minorFactor('ARS')).toBe(100);
    expect(minorFactor('USD')).toBe(100);
  });

  it('returns 1 for currencies with 0 decimals (CLP/PYG)', () => {
    expect(minorFactor('CLP')).toBe(1);
    expect(minorFactor('PYG')).toBe(1);
  });
});

describe('hasDecimals', () => {
  it('is false for CLP/PYG', () => {
    expect(hasDecimals('CLP')).toBe(false);
    expect(hasDecimals('PYG')).toBe(false);
  });

  it('is true for the rest', () => {
    expect(hasDecimals('ARS')).toBe(true);
    expect(hasDecimals('USD')).toBe(true);
  });
});

describe('parseMoney — regresión del bug detectado por el PO', () => {
  it('150.00,23 en es-AR NO pierde los centavos (NO da 15000)', () => {
    // Bug original: tratar '.' como decimal tiraba los centavos → 15000.
    // Correcto: la ÚLTIMA coma es el decimal → $15.000,23 → 1500023.
    expect(parseMoney('150.00,23', 'ARS', 'es')).toBe(1500023);
    expect(parseMoney('150.00,23', 'ARS', 'es')).not.toBe(15000);
  });
});

describe('parseMoney — casos §3(f) del ADR-002', () => {
  it('es-AR 150.000,23 -> 15000023', () => {
    expect(parseMoney('150.000,23', 'ARS', 'es')).toBe(15000023);
  });

  it('es-AR 150000,23 -> 15000023', () => {
    expect(parseMoney('150000,23', 'ARS', 'es')).toBe(15000023);
  });

  it('es-AR 150,239 redondea a 15024 (robustez de parseMoney como backstop de paste/programático — el input acotado ya impide tipear un 3er decimal, corrección PO 2026-07-20)', () => {
    expect(parseMoney('150,239', 'ARS', 'es')).toBe(15024);
  });

  it('CLP 1500 -> 1500 (sin decimales)', () => {
    expect(parseMoney('1500', 'CLP', 'es')).toBe(1500);
  });

  it('CLP ignora cualquier separador decimal tipeado (bloqueado en UI, defensivo en parse)', () => {
    expect(parseMoney('1.500', 'CLP', 'es')).toBe(1500);
    expect(parseMoney('1,500', 'CLP', 'es')).toBe(1500);
  });
});

describe('parseMoney — idioma en (decimal = punto)', () => {
  it('en-US 1,500.23 -> 150023', () => {
    expect(parseMoney('1,500.23', 'USD', 'en')).toBe(150023);
  });

  it('en malformado 1,50.23 (coma como miles, última . como decimal) -> 15023', () => {
    expect(parseMoney('1,50.23', 'USD', 'en')).toBe(15023);
  });
});

describe('parseMoney — idioma pt (mismo criterio que es: coma decimal)', () => {
  it('pt-BR 150.000,23 -> 15000023', () => {
    expect(parseMoney('150.000,23', 'BRL', 'pt')).toBe(15000023);
  });
});

describe('parseMoney — edge cases', () => {
  it('texto vacío -> 0', () => {
    expect(parseMoney('', 'ARS', 'es')).toBe(0);
  });

  it('solo separador -> 0', () => {
    expect(parseMoney(',', 'ARS', 'es')).toBe(0);
  });

  it('sin separador decimal -> parte entera exacta', () => {
    expect(parseMoney('1500', 'ARS', 'es')).toBe(150000);
  });
});

describe('invariante parseMoney(formatMoney(m, c), c, lang) === m', () => {
  const cases: { m: number; c: 'ARS' | 'USD' | 'CLP' | 'BRL'; lang: 'es' | 'en' | 'pt' }[] = [
    { m: 15000023, c: 'ARS', lang: 'es' },
    { m: 1500023,  c: 'ARS', lang: 'es' },
    { m: 100,      c: 'ARS', lang: 'es' },
    { m: 0,        c: 'ARS', lang: 'es' },
    { m: 150000,   c: 'USD', lang: 'en' },
    { m: 1500,     c: 'CLP', lang: 'es' },
    { m: 999999,   c: 'CLP', lang: 'es' },
    { m: 15000023, c: 'BRL', lang: 'pt' },
  ];

  /**
   * Desde T-066 el formateo también tiene idioma, así que la invariante se
   * enuncia completa: **leer y escribir con el MISMO idioma no pierde plata.**
   *
   * Antes `formatMoney` usaba el locale de la moneda y `parseMoney` el idioma
   * de la app, y esta invariante pasaba por casualidad — el caso USD/en la
   * cumplía porque en-US coincidía con el locale del dólar. Con el idioma en
   * español, `formatMoney(150000,'USD')` daba `US$1,500.00` y parsearlo en
   * español devolvía **150**: tres órdenes de magnitud, en silencio.
   */
  it.each(cases)('round-trips $m $c ($lang)', ({ m, c, lang }) => {
    setFormatLanguage(lang);
    expect(parseMoney(formatMoney(m, c), c, lang)).toBe(m);
  });

  // El caso que el bug producía: formatear en un idioma y parsear en otro.
  // No se puede arreglar en `parseMoney` —`US$1,500.00` es ambiguo sin saber
  // quién lo escribió—, así que la app no puede permitirse mezclarlos.
  it('formatear en un idioma y parsear en otro SÍ pierde plata', () => {
    setFormatLanguage('en');
    const enIngles = formatMoney(150000, 'USD');   // US$1,500.00
    expect(parseMoney(enIngles, 'USD', 'es')).not.toBe(150000);
    setFormatLanguage('es');
  });
});

/**
 * **Un solo separador por pantalla, siempre.**
 *
 * Es el bug que el PO levantó viéndolo renderizado: `US$1,234.56` arriba y
 * `€1234,56` abajo, en la misma lista de balances. **La coma significaba
 * "miles" en una fila y "decimales" en la de al lado.** Venía de formatear cada
 * moneda con SU locale en vez de con el idioma de quien mira.
 *
 * No hay convención mundial que copiar —ISO 80000-1 recomienda espacio fino
 * justamente porque coma y punto son ambiguos entre países—, así que lo único
 * defendible es ser consistente para el lector.
 */
describe('todas las monedas se leen con la misma convención', () => {
  const MONEDAS = ['ARS', 'USD', 'EUR', 'BRL', 'CLP', 'BOB', 'PYG', 'UYU', 'PEN'] as const;

  /** Los separadores que quedan tras sacar dígitos y símbolo. */
  const separadores = (s: string) => [...s.replace(/[\d\s]/g, '')].filter(c => c === '.' || c === ',');

  it.each(['es', 'en', 'pt'] as const)('en %s, ninguna moneda usa otro separador', lang => {
    setFormatLanguage(lang);
    const miles = lang === 'en' ? ',' : '.';

    for (const code of MONEDAS) {
      // 1.234.567,89 en es/pt · 1,234,567.89 en en — con miles Y decimales.
      const texto = formatMoney(123456789, code);
      const usados = new Set(separadores(texto));
      expect(`${lang} ${code} ${texto}`).toBe(`${lang} ${code} ${texto}`);
      // El separador de miles tiene que ser el del idioma, en TODAS.
      expect(`${code}: ${usados.has(miles)}`).toBe(`${code}: true`);
    }
    setFormatLanguage('es');
  });

  // El caso concreto de la captura del PO: dólar y euro, uno al lado del otro.
  it('el dólar y el euro no se contradicen', () => {
    setFormatLanguage('es');
    expect(formatMoney(123456, 'USD')).toBe('US$1.234,56');
    expect(formatMoney(123456, 'EUR')).toBe('€1.234,56');

    setFormatLanguage('en');
    expect(formatMoney(123456, 'USD')).toBe('US$1,234.56');
    expect(formatMoney(123456, 'EUR')).toBe('€1,234.56');
    setFormatLanguage('es');
  });

  // Las de cero decimales no pueden quedar con una coma decimal huérfana.
  it('CLP y PYG no muestran decimales en ningún idioma', () => {
    for (const lang of ['es', 'en', 'pt'] as const) {
      setFormatLanguage(lang);
      expect(`${lang} CLP: ${formatMoney(1234567, 'CLP')}`).not.toMatch(/[.,]\d\d$/);
      expect(`${lang} PYG: ${formatMoney(1234567, 'PYG')}`).not.toMatch(/[.,]\d\d$/);
    }
    setFormatLanguage('es');
  });
});
