import type { CurrencyCode } from '@/src/constants/currencies';
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

  it('descarta el separador de miles tipeado y lo REGENERA el (PO 2026-08-30)', () => {
    // El separador que escribe el usuario se sigue descartando: nunca se
    // confia en donde lo puso. Lo que cambio es que despues se re-agrupa solo,
    // en vez de quedar el texto pelado hasta el blur.
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('1.500,50'));
    expect(result.current.text).toBe('1.500,50');
    expect(result.current.minor).toBe(150050);
  });

  it('un separador de miles puesto en un lugar ABSURDO se reacomoda', () => {
    // Prueba que no se respeta lo tipeado sino que se reagrupa de cero.
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('1.5.0.0,50'));   // digitos: 1500
    expect(result.current.text).toBe('1.500,50');
  });

  it('bloquea el separador DECIMAL en monedas sin decimales (CLP), aunque agrupe miles', () => {
    const { result } = renderHook(() => useAmountInput('CLP'));
    // Simula tipear "1500" seguido de un intento de "," (bloqueado — se descarta).
    act(() => result.current.onChangeText('1500'));
    act(() => result.current.onChangeText('1500,'));
    // El punto que se ve es agrupacion de miles, NO un decimal: lo prueba el
    // valor canonico, que sigue siendo 1500 y no 15.
    expect(result.current.text).toBe('1.500');
    expect(result.current.minor).toBe(1500);
  });

  it('en CLP ningun decimal sobrevive por mas vueltas que se den', () => {
    const { result } = renderHook(() => useAmountInput('CLP'));
    act(() => result.current.onChangeText('1500,99'));
    expect(result.current.minor).toBe(150099);  // los digitos entran como enteros
    expect(result.current.text).not.toContain(',');
  });

  it('SI agrupa en cada tecla (PO 2026-08-30 — reemplaza la regla F-16b.4)', () => {
    // La regla anterior era no reformatear mientras se tipea. El PO la cambio:
    // en montos largos, ver "1500000" sin separadores obliga a contar ceros de
    // a uno para saber si escribiste lo que querias.
    const { result } = renderHook(() => useAmountInput('ARS'));
    act(() => result.current.onChangeText('1500'));
    expect(result.current.text).toBe('1.500');
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

/**
 * Separador de miles MIENTRAS SE TIPEA (pedido del PO 2026-08-30).
 *
 * Antes solo aparecía al salir del campo: tipeabas "1500000" y veías
 * "1500000" hasta el blur. En montos largos —y con monedas como PYG o CLP,
 * donde un gasto normal tiene 6 o 7 dígitos— es imposible saber si escribiste
 * lo que querías sin contar los ceros de a uno.
 *
 * El texto agrupado tiene que seguir siendo re-parseable por `parseMoney` con
 * el MISMO idioma, que es la invariante que sostiene todo este módulo.
 */
describe('agrupacion de miles al tipear', () => {
  const es = (code: CurrencyCode = 'ARS') => renderHook(() => useAmountInput(code));

  it('agrupa de a tres desde los miles', () => {
    const { result } = es();
    act(() => result.current.onChangeText('1500'));
    expect(result.current.text).toBe('1.500');
  });

  it('millones', () => {
    const { result } = es();
    act(() => result.current.onChangeText('1500000'));
    expect(result.current.text).toBe('1.500.000');
  });

  it('miles de millones', () => {
    const { result } = es();
    act(() => result.current.onChangeText('1500000000'));
    expect(result.current.text).toBe('1.500.000.000');
  });

  it('menos de mil no se agrupa', () => {
    const { result } = es();
    act(() => result.current.onChangeText('999'));
    expect(result.current.text).toBe('999');
  });

  it('lo agrupado sigue valiendo el mismo monto', () => {
    // La invariante que no se puede romper: lo que se ve se puede re-parsear.
    const { result } = es();
    act(() => result.current.onChangeText('1500000'));
    expect(result.current.minor).toBe(150_000_000); // 1.500.000,00 ARS
  });

  it('con decimales, solo se agrupa la parte entera', () => {
    const { result } = es();
    act(() => result.current.onChangeText('1500000,25'));
    expect(result.current.text).toBe('1.500.000,25');
    expect(result.current.minor).toBe(150_000_025);
  });

  it('una moneda sin decimales tambien se agrupa (PYG)', () => {
    const { result } = es('PYG');
    act(() => result.current.onChangeText('2500000'));
    expect(result.current.text).toBe('2.500.000');
    expect(result.current.minor).toBe(2_500_000);
  });

  it('los ceros a la izquierda no ensucian la agrupacion', () => {
    const { result } = es();
    act(() => result.current.onChangeText('0001500'));
    expect(result.current.text).toBe('1.500');
  });

  it('un cero solo sigue siendo un cero', () => {
    const { result } = es();
    act(() => result.current.onChangeText('0'));
    expect(result.current.text).toBe('0');
  });

  it('borrar digitos reagrupa hacia atras', () => {
    const { result } = es();
    act(() => result.current.onChangeText('1500000'));
    act(() => result.current.onChangeText('1.500.00'));  // el usuario borro un digito
    expect(result.current.text).toBe('150.000');
  });

  // T-254: el teclado muestra el separador de la región, no el del idioma de la app.
  it('app en español con teclado de punto: "12.50" es 12,50 (no 1250)', () => {
    mockLanguage = 'es';
    const { result } = renderHook(() => useAmountInput('USD'));
    act(() => result.current.onChangeText('12.50'));
    expect(result.current.text).toBe('12,50');
    expect(result.current.minor).toBe(1250);
  });

  it('app en inglés con teclado de coma: "12,50" es 12.50', () => {
    mockLanguage = 'en';
    const { result } = renderHook(() => useAmountInput('USD'));
    act(() => result.current.onChangeText('12,50'));
    expect(result.current.minor).toBe(1250);
  });

  it('borrar el último dígito de un monto agrupado no inventa un decimal', () => {
    mockLanguage = 'es';
    const { result } = renderHook(() => useAmountInput('USD'));
    act(() => result.current.onChangeText('1250'));          // se muestra 1.250
    expect(result.current.text).toBe('1.250');
    act(() => result.current.onChangeText('1.25'));          // backspace
    expect(result.current.text).toBe('125');
    expect(result.current.minor).toBe(12500);
  });

  it('CLP: "1.500" sigue siendo mil quinientos', () => {
    mockLanguage = 'es';
    const { result } = renderHook(() => useAmountInput('CLP'));
    act(() => result.current.onChangeText('1.500'));
    expect(result.current.minor).toBe(1500);
  });

  describe('cambio de moneda con un monto ya tipeado (T-258: el texto no se toca)', () => {
    beforeEach(() => { mockLanguage = 'es'; });

    const montar = (code: CurrencyCode, initialMinor = 0) => renderHook(
      ({ code }: { code: CurrencyCode }) => useAmountInput(code, initialMinor),
      { initialProps: { code } },
    );

    it('ARS 12,50 → USD: el texto sigue 12,50 y el minor es 1250', () => {
      const { result, rerender } = montar('ARS');
      act(() => result.current.onChangeText('12,50'));
      rerender({ code: 'USD' });
      expect(result.current.text).toBe('12,50');
      expect(result.current.minor).toBe(1250);
      expect(result.current.decimalesNoAdmitidos).toBe(false);
    });

    it('ARS 12,50 → CLP: el texto queda tal cual, marca el error y se puede corregir', () => {
      const { result, rerender } = montar('ARS');
      act(() => result.current.onChangeText('12,50'));
      rerender({ code: 'CLP' });
      expect(result.current.text).toBe('12,50');
      expect(result.current.decimalesNoAdmitidos).toBe(true);
      // Borrar el «0» y luego el «5» no pega los dígitos: sigue siendo 12,5 y después 12,.
      act(() => result.current.onChangeText('12,5'));
      expect(result.current.text).toBe('12,5');
      act(() => result.current.onChangeText('12,'));
      expect(result.current.decimalesNoAdmitidos).toBe(false);
      act(() => result.current.onChangeText('12'));
      expect(result.current.text).toBe('12');
      expect(result.current.minor).toBe(12);
      expect(result.current.decimalesNoAdmitidos).toBe(false);
    });

    it('el error también se va al volver a una moneda con decimales', () => {
      const { result, rerender } = montar('ARS');
      act(() => result.current.onChangeText('12,50'));
      rerender({ code: 'CLP' });
      expect(result.current.decimalesNoAdmitidos).toBe(true);
      rerender({ code: 'ARS' });
      expect(result.current.decimalesNoAdmitidos).toBe(false);
      expect(result.current.minor).toBe(1250);
    });

    it('con decimales en cero («12,00») no hay error: el valor es exacto', () => {
      const { result, rerender } = montar('ARS');
      act(() => result.current.onChangeText('12,00'));
      rerender({ code: 'CLP' });
      expect(result.current.decimalesNoAdmitidos).toBe(false);
      expect(result.current.minor).toBe(12);
    });

    it('en CLP sigue bloqueado el separador decimal al tipear', () => {
      const { result } = montar('CLP');
      act(() => result.current.onChangeText('12,5'));
      expect(result.current.text).toBe('125');
    });

    it('CLP 1.500 → ARS: el texto sigue 1.500 y el minor es 150000', () => {
      const { result, rerender } = montar('CLP');
      act(() => result.current.onChangeText('1500'));
      expect(result.current.text).toBe('1.500');
      rerender({ code: 'ARS' });
      expect(result.current.text).toBe('1.500');
      expect(result.current.minor).toBe(150000);
      act(() => result.current.onChangeText('1.500,5'));
      expect(result.current.minor).toBe(150050);
    });

    it('en inglés: USD 12.50 → CLP marca error y 12 → minor 12', () => {
      mockLanguage = 'en';
      const { result, rerender } = montar('USD');
      act(() => result.current.onChangeText('12.50'));
      rerender({ code: 'CLP' });
      expect(result.current.text).toBe('12.50');
      expect(result.current.decimalesNoAdmitidos).toBe(true);
      act(() => result.current.onChangeText('12'));
      expect(result.current.minor).toBe(12);
    });

    it('el blur con el error activo no reescribe el texto', () => {
      const { result, rerender } = montar('ARS');
      act(() => result.current.onChangeText('12,50'));
      rerender({ code: 'CLP' });
      act(() => result.current.onBlur());
      expect(result.current.text).toBe('12,50');
    });

    it('con el campo vacío no inventa un monto', () => {
      const { result, rerender } = montar('ARS');
      rerender({ code: 'CLP' });
      expect(result.current.text).toBe('');
      expect(result.current.decimalesNoAdmitidos).toBe(false);
    });

    it('editar un gasto existente no cambia el monto ni en el primer render ni al re-renderizar', () => {
      const { result, rerender } = montar('ARS', 123456);
      expect(result.current.minor).toBe(123456);
      expect(result.current.text).toBe('1.234,56');
      rerender({ code: 'ARS' });
      expect(result.current.minor).toBe(123456);
      expect(result.current.text).toBe('1.234,56');
    });
  });
});
