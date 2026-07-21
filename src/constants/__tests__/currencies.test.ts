import { formatMoney, hasDecimals, minorFactor, parseMoney } from '../currencies';

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

  it.each(cases)('round-trips $m $c ($lang)', ({ m, c, lang }) => {
    expect(parseMoney(formatMoney(m, c), c, lang)).toBe(m);
  });
});
