import { sanitizeTypedAmount, MAX_DIGITOS_MONTO } from '../sanitizeAmount';
import type { AppLang, CurrencyCode } from '@/src/constants/currencies';

// T-254: el teclado `decimal-pad` muestra el separador de la REGIÓN del
// teléfono, que no tiene por qué coincidir con el idioma de la app.
type Caso = [raw: string, lang: AppLang, code: CurrencyCode, esperado: string, prev?: string];

const CASOS: Caso[] = [
  // punto de teclado regional en app en español / portugués
  ['12.50', 'es', 'USD', '12,50'],
  ['12.5',  'es', 'USD', '12,5'],
  ['12.',   'es', 'USD', '12,'],
  ['12.50', 'pt', 'USD', '12,50'],
  ['12,50', 'es', 'USD', '12,50'],
  ['12,50', 'pt', 'USD', '12,50'],
  // coma de teclado regional en app en inglés
  ['12,50', 'en', 'USD', '12.50'],
  ['12,5',  'en', 'USD', '12.5'],
  ['12.50', 'en', 'USD', '12.50'],
  // tres dígitos después del separador ajeno = agrupación, no decimal
  ['1.250',     'es', 'USD', '1.250'],
  ['1.2500',    'es', 'USD', '12.500'],
  ['12.505',    'es', 'USD', '12.505'],
  ['1.250.000', 'es', 'USD', '1.250.000'],
  ['1,250',     'en', 'USD', '1,250'],
  ['1,2500',    'en', 'USD', '12,500'],
  // ya agrupado + decimal del teclado
  ['1.250.',    'es', 'USD', '1.250,'],
  ['1.250.5',   'es', 'USD', '1.250,5'],
  ['1.250,5',   'es', 'USD', '1.250,5'],
  ['1,250.5',   'en', 'USD', '1,250.5'],
  // un separador ajeno tipeado DESPUÉS del decimal propio se ignora
  ['1.250,5.',  'es', 'USD', '1.250,5'],
  // pegar texto con formato de otra región
  ['1,250.50',  'es', 'USD', '1.250,50'],
  ['1.250,50',  'en', 'USD', '1,250.50'],
  // tope de decimales y de ceros a la izquierda
  ['150,555',   'es', 'USD', '150,55'],
  ['150.555',   'es', 'USD', '150.555'],
  ['0001500',   'es', 'USD', '1.500'],
  // borrar el último dígito de «1.250» NO convierte la agrupación en decimal
  ['1.25',      'es', 'USD', '125',   '1.250'],
  ['1,25',      'en', 'USD', '125',   '1,250'],
  // sin decimales: ningún separador es decimal
  ['1.500',  'es', 'CLP', '1.500'],
  ['1,500',  'es', 'CLP', '1.500'],
  ['1.500',  'en', 'CLP', '1,500'],
  ['1,500',  'en', 'PYG', '1,500'],
  ['12.5',   'es', 'CLP', '125'],
  ['12,5',   'en', 'PYG', '125'],
  // basura
  ['abc',    'es', 'USD', ''],
  ['',       'en', 'USD', ''],
];

describe('sanitizeTypedAmount (T-254)', () => {
  // Rest param: con 5 parámetros fijos jest lo toma por un callback `done`.
  it.each(CASOS)('%j (%s, %s) → %j', (...fila) => {
    const [raw, lang, code, esperado, prev] = fila;
    expect(sanitizeTypedAmount(raw, code, lang, prev)).toBe(esperado);
  });

  it('el texto normalizado es idempotente', () => {
    for (const [raw, lang, code] of CASOS) {
      const una = sanitizeTypedAmount(raw, code, lang);
      expect(sanitizeTypedAmount(una, code, lang)).toBe(una);
    }
  });

  describe('tope de dígitos (el monto en unidades menores cabe en Number.MAX_SAFE_INTEGER)', () => {
    const digitos = (s: string) => s.replace(/\D/g, '');

    it('USD: no pasa de MAX_DIGITOS_MONTO dígitos contando los decimales', () => {
      const out = sanitizeTypedAmount('9'.repeat(30) + ',99', 'USD', 'es');
      expect(digitos(out).length).toBeLessThanOrEqual(MAX_DIGITOS_MONTO);
    });

    it('CLP: tampoco', () => {
      const out = sanitizeTypedAmount('9'.repeat(30), 'CLP', 'es');
      expect(digitos(out).length).toBe(MAX_DIGITOS_MONTO);
    });

    it('el máximo posible sigue siendo un entero seguro', () => {
      expect(Number('9'.repeat(MAX_DIGITOS_MONTO))).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    });
  });
});
