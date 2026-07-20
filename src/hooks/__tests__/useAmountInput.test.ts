import { act, renderHook } from '@testing-library/react-native';

// Sobreescribe el mock global de react-i18next (test-utils/setup.ts) para
// poder variar el idioma activo por test — el hook depende de i18n.language
// para decidir el separador decimal (F-16b.1).
let mockLanguage = 'es';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: mockLanguage, changeLanguage: jest.fn() },
  }),
}));

import { useAmountInput } from '../useAmountInput';

describe('useAmountInput', () => {
  beforeEach(() => {
    mockLanguage = 'es';
  });

  it('starts empty and with minor=0 when no initial amount is given', () => {
    const { result } = renderHook(() => useAmountInput('ARS'));
    expect(result.current.text).toBe('');
    expect(result.current.minor).toBe(0);
  });

  it('parses the canonical minor amount as the user types (es → coma decimal)', () => {
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('150,23'));
    expect(result.current.minor).toBe(15023);
  });

  // Decimales ACOTADOS (corrección PO 2026-07-20, reemplaza "decimales libres +
  // redondeo" — F-16b.3 / 01_requirements.md:72).
  it('no separator typed -> whole amount, no fraction ("150" -> $150,00)', () => {
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('150'));
    expect(result.current.text).toBe('150');
    expect(result.current.minor).toBe(15000);
  });

  it('one decimal digit typed -> accepted as-is ("150,5" -> 15050)', () => {
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('150,5'));
    expect(result.current.minor).toBe(15050);
  });

  it('exactly `decimals` digits typed -> accepted ("150,55" -> 15055)', () => {
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('150,55'));
    expect(result.current.text).toBe('150,55');
    expect(result.current.minor).toBe(15055);
  });

  it('blocks a 3rd decimal digit — it never reaches the text or parseMoney', () => {
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('150,55'));
    act(() => result.current.onChangeText('150,555')); // simulates the next keystroke
    expect(result.current.text).toBe('150,55'); // el 3er decimal se descarta
    expect(result.current.minor).toBe(15055);
  });

  it('blocks a 2nd decimal separator occurrence', () => {
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('150,5,5'));
    expect(result.current.text).toBe('150,55');
  });

  it('discards a manually-typed thousands separator (users never type it)', () => {
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('1.500,50'));
    expect(result.current.text).toBe('1500,50');
    expect(result.current.minor).toBe(150050);
  });

  it('blocks any decimal/thousands separator character for currencies without decimals (CLP)', () => {
    const { result } = renderHook(() => useAmountInput('CLP'));
    // Simula tipear "1500" seguido de un intento de "," (bloqueado — se descarta).
    act(() => result.current.onChangeText('1500'));
    act(() => result.current.onChangeText('1500,'));
    expect(result.current.text).toBe('1500'); // la coma nunca llega al texto
    expect(result.current.minor).toBe(1500);
  });

  it('does NOT reformat the text on every keystroke (raw text preserved while typing)', () => {
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('1500'));
    expect(result.current.text).toBe('1500'); // texto crudo, sin separador de miles insertado
  });

  it('formats the text on blur without changing the canonical minor value', () => {
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('150023'));
    const before = result.current.minor;
    act(() => result.current.onBlur());
    expect(result.current.minor).toBe(before);
    expect(result.current.text).not.toBe('150023'); // se formateó
  });

  it('round-trips through blur: re-editing the blurred text yields the same minor amount', () => {
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('150000,23'));
    const original = result.current.minor;
    act(() => result.current.onBlur());
    // El texto post-blur debe seguir siendo interpretable por el mismo lang
    // sin perder valor (evita el bug de re-lectura con locale incoherente).
    expect(result.current.minor).toBe(original);
  });

  it('setMinor re-initializes the input (e.g. loading an existing amount to edit)', () => {
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.setMinor(500000));
    expect(result.current.minor).toBe(500000);
    expect(result.current.text.length).toBeGreaterThan(0);
  });

  it('uses "." as the decimal separator when the app language is "en"', () => {
    mockLanguage = 'en';
    const { result } = renderHook(() => useAmountInput('USD'));
    act(() => result.current.onChangeText('1,500.23'));
    expect(result.current.minor).toBe(150023);
  });

  it('falls back to "es" semantics for an unsupported/unknown language value', () => {
    mockLanguage = 'fr';
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('150,23'));
    expect(result.current.minor).toBe(15023);
  });
});
