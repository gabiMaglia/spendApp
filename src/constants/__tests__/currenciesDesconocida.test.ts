import { formatAmount, formatMoney, hasDecimals, minorFactor, parseMoney, toMinorUnits, type CurrencyCode } from '../currencies';

/**
 * T-264: un código que esta versión no conoce (llegado por sync desde una
 * versión futura) no puede tumbar el render. Se degrada a 2 decimales y el
 * código hace de símbolo.
 */
const FUTURA = 'XYZ' as CurrencyCode;

describe('moneda desconocida', () => {
  it('formatMoney no lanza y usa el código como símbolo', () => {
    expect(() => formatMoney(123456, FUTURA)).not.toThrow();
    expect(formatMoney(123456, FUTURA)).toContain('XYZ');
    expect(formatMoney(123456, FUTURA)).toContain('56');
  });

  it('asume 2 decimales en todo lo que depende de ellos', () => {
    expect(minorFactor(FUTURA)).toBe(100);
    expect(hasDecimals(FUTURA)).toBe(true);
    expect(toMinorUnits(1.5, FUTURA)).toBe(150);
    expect(parseMoney('12,34', FUTURA, 'es')).toBe(1234);
    expect(() => formatAmount(0, FUTURA)).not.toThrow();
  });

  it('las monedas conocidas siguen igual', () => {
    expect(minorFactor('CLP')).toBe(1);
  });
});
