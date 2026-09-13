import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { crearRegistroDeMontos } from '@/src/utils/montoRodanteRegistry';
import { formatMoney } from '@/src/constants/currencies';

/**
 * T-109 (innegociable del PO): durante un cambio de moneda, en NINGÚN frame
 * puede verse el monto en la divisa anterior, el monto sin convertir, ni
 * ningún número intermedio que no sea el valor final. Mientras la conversión
 * está pendiente se ve `--`; al resolverse, un solo giro (o, si hay
 * conversión de por medio, directo al valor final — ver `MontoRodante.tsx`,
 * `vinoDePendingRef`) sin pasar por la semilla de dígitos invertidos.
 *
 * Este test mockea `number-flow-react-native` para grabar CADA valor que
 * recibió la librería (no lo que el DOM/accessibility label muestra, que ya
 * cubre `MontoRodante.test.tsx`) y arma la secuencia completa vista en
 * pantalla —incluido el placeholder textual—, para probar que nunca aparece
 * nada entre `--` y el valor final.
 */
const valoresRecibidosPorLaLibreria: number[] = [];
const propsRecibidasPorLaLibreria: { value: number; prefix?: string }[] = [];

jest.mock('number-flow-react-native', () => {
  const actual = jest.requireActual('number-flow-react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactActual = require('react');
  return {
    ...actual,
    NumberFlow: (props: { value: number; prefix?: string; [k: string]: unknown }) => {
      valoresRecibidosPorLaLibreria.push(props.value);
      propsRecibidasPorLaLibreria.push({ value: props.value, prefix: props.prefix });
      return ReactActual.createElement(actual.NumberFlow, props);
    },
  };
});

// Import DESPUÉS del mock (requerido por cómo jest.mock hoistea).
// eslint-disable-next-line import/first
import { MontoRodante } from '../MontoRodante';

describe('MontoRodante — cambio de moneda SIN `pending` (símbolo antes que dígitos, T-109)', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    valoresRecibidosPorLaLibreria.length = 0;
    propsRecibidasPorLaLibreria.length = 0;
  });
  afterEach(() => jest.restoreAllMocks());

  /**
   * Síntoma reportado por el PO en el teléfono, sobre `main` sin este fix:
   * al cambiar de moneda, el SÍMBOLO cambiaba antes que el número — un frame
   * mostraba el prefijo nuevo con los dígitos viejos. Acá no hay ninguna
   * conversión async (`pending`) de por medio: el `code` cambia solo, ya
   * resuelto (caso típico: la cache de cotizaciones ya estaba tibia).
   */
  it('nunca hay un valor de NumberFlow bajo el prefijo de la moneda equivocada', async () => {
    const registro = crearRegistroDeMontos();
    const r = render(<MontoRodante id="home.net" minor={100000} code="ARS" registry={registro} />);
    await r.findByLabelText(formatMoney(100000, 'ARS'));
    propsRecibidasPorLaLibreria.length = 0; // sólo interesa desde acá

    r.rerender(<MontoRodante id="home.net" minor={100000} code="USD" registry={registro} />);
    // El DOM nunca vuelve a mostrar el label de ARS una vez detectado el cambio.
    expect(r.queryByLabelText(formatMoney(100000, 'ARS'))).toBeNull();

    await r.findByLabelText(formatMoney(100000, 'USD'));

    // La afirmación dura: NINGÚN render que llegó a la librería, desde que se
    // detectó el cambio, tuvo el prefijo VIEJO de ARS (`$`) — la librería
    // sólo vio placeholder-less renders ya bajo `US$`. `format`/`prefix`/
    // `value` viajan siempre juntos, nunca por separado.
    expect(propsRecibidasPorLaLibreria.length).toBeGreaterThan(0);
    for (const p of propsRecibidasPorLaLibreria) {
      expect(p.prefix).toBe('US$');
    }
  });
});

describe('MontoRodante — secuencia exacta durante un cambio de moneda (T-109)', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    valoresRecibidosPorLaLibreria.length = 0;
  });

  afterEach(() => jest.restoreAllMocks());

  it('la secuencia es exactamente [placeholder, valorFinal] — sin ningún intermedio', async () => {
    const registro = crearRegistroDeMontos();
    const secuencia: (string | number)[] = [];

    // Arranca con la conversión en curso: el minor "de paso" (0) NUNCA debe
    // llegar a la librería — por eso ni se monta `NumberFlow` mientras pending.
    const r = render(
      <MontoRodante
        id="home.net" minor={0} code="ARS" registry={registro}
        pending pendingAccessibilityLabel="calculando"
      />,
    );
    expect(r.getByLabelText('calculando')).toBeTruthy();
    secuencia.push('--');
    // Ninguna llamada a la librería todavía: el placeholder es un <Text> aparte.
    expect(valoresRecibidosPorLaLibreria).toEqual([]);

    // La conversión resuelve con el valor final ya convertido (5.555 ARS).
    r.rerender(<MontoRodante id="home.net" minor={555500} code="ARS" registry={registro} />);
    await r.findByLabelText(formatMoney(555500, 'ARS'));

    const valorFinal = 5555; // 555500 minor / 100 (ARS)
    for (const v of valoresRecibidosPorLaLibreria) secuencia.push(v);

    // La afirmación dura: la librería SÓLO vio el valor final, nunca una
    // semilla ni ningún otro número — y la pantalla sólo mostró `--` antes.
    expect(valoresRecibidosPorLaLibreria.every(v => v === valorFinal)).toBe(true);
    expect(secuencia).toEqual(['--', valorFinal]);
  });

  it('sin fx de por medio (aparición normal), la semilla SIGUE existiendo — no se rompió T-106', async () => {
    // Control: este test prueba que el cambio de T-109 es específico del
    // camino `pending`, no una regresión general de la semilla de T-106.
    const registro = crearRegistroDeMontos();
    render(<MontoRodante id="otro.id" minor={0} code="ARS" registry={registro} />);
    // Con `minor=0` el valor real y el placeholder inicial coinciden en texto
    // ("$0"), así que `findByLabelText` no sirve para esperar la secuencia
    // completa — se deja correr la promesa de `AccessibilityInfo` y el
    // `setTimeout` del escalonado con un `act` async.
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // La semilla de 0 es 5 (numeroSemilla, +5 mod 10) — sigue apareciendo en
    // algún momento de la secuencia cuando NO hubo conversión pendiente de
    // por medio (el primer valor pintado es el real, T-106 lo documenta así:
    // el montaje inicial ya arranca en el valor real y el efecto swap-ea a la
    // semilla casi enseguida — por eso se busca en toda la secuencia, no en
    // el índice 0).
    expect(valoresRecibidosPorLaLibreria).toContain(5);
  });
});
