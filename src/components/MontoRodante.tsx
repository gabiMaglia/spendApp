import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, StyleSheet, View, type StyleProp, type TextStyle,
} from 'react-native';
import { NumberFlow } from 'number-flow-react-native';

import {
  formatMoney, getCurrency, getFormatLocale, minorFactor, type CurrencyCode,
} from '@/src/constants/currencies';
import {
  debeRodar, numeroSemilla, registroDeMontosDeLaApp, type MontoRegistry,
} from '@/src/utils/montoRodanteRegistry';

type MontoRodanteProps = {
  /**
   * Identidad ESTABLE de esta posición en pantalla (no el valor) — ej.
   * `'home.disponible'`, `'groupDetail.balance:g1'`. Define qué cuenta como
   * "el mismo monto" para decidir si animar. Ver `montoRodanteRegistry`.
   */
  id: string;
  /**
   * Entero en menor unidad — mismo contrato que `formatMoney`. Para conteos
   * simples SIN moneda (ej. el box 2×2 de Grupos, que también tiene "cantidad
   * de grupos"/"cantidad de gastos"), omitir `code`: se muestra `minor` tal
   * cual, entero, sin agrupar miles.
   */
  minor: number;
  code?: CurrencyCode;
  /** Prefijo fijo pegado ANTES del símbolo de moneda — igual que `MoneyText` (ej. '+'). */
  prefix?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  /** Inyectable sólo para tests; en producción usa el registro único de la app. */
  registry?: MontoRegistry;
};

/**
 * **Números que "giran"** (T-106, estilo Binance).
 *
 * Wrapper de proyecto sobre `number-flow-react-native` (única dependencia
 * nueva del ticket, aprobada por el Orquestador — renderer de Views, JS puro,
 * sin código nativo). Las pantallas nunca importan la librería directo: le
 * pasan un monto (`minor`+`code`, mismo contrato que `formatMoney`) o un
 * conteo simple, y este componente arma el `value`/`format`/`locales`/`prefix`
 * de la librería para que el texto final sea BYTE A BYTE el de `formatMoney`
 * (nunca se re-formatea a mano acá — sale de la misma función).
 *
 * **Cuándo rueda** (regla del PO, 2026-09-13): la PRIMERA vez que este `id`
 * se muestra en la sesión de la app, y cada vez que el valor CAMBIA de
 * verdad (cambio de divisa, nuevo gasto/ingreso, post-sync). Volver a una
 * pantalla con el mismo valor no anima. Decisión pura en
 * `montoRodanteRegistry.debeRodar` — acá sólo se consume.
 *
 * **Si el valor es 0 (o no cambia contra la semilla) igual tiene que girar**
 * en la primera aparición: la librería anima por DIFERENCIA entre el valor
 * anterior y el nuevo, así que montar directo en el real no dispara nada
 * (0→0 no es un cambio — se confirmó revisando su código: `continuous` sólo
 * hace girar dígitos sin cambios cuando OTRO de mayor orden sí cambió). Por
 * eso, en la primera aparición, se monta con `numeroSemilla` (un valor que
 * difiere del real en TODOS los dígitos, mismo formato) y al frame siguiente
 * se pasa al real — la librería ve un cambio genuino en cada columna. Es
 * media vuelta (la semilla es diametralmente opuesta en la rueda), no varias
 * vueltas completas: la librería no tiene un primitivo de multi-vuelta por
 * dígito — limitación conocida, documentada en el handoff.
 *
 * Con "reducir movimiento" (`respectMotionPreference`, built-in de la
 * librería + gate propio para no aplicar el truco de semilla) se muestra el
 * valor final directo.
 */
export function MontoRodante({
  id, minor, code, prefix = '', style, testID, registry = registroDeMontosDeLaApp,
}: MontoRodanteProps) {
  // `null` = todavía no sabemos (la consulta es async). Arrancar en `false`
  // por default causaba que la primera aparición SIEMPRE aplicara el truco
  // de semilla antes de que la consulta real resolviera, incluso con
  // "reducir movimiento" activado — se detectó con el propio test. El valor
  // MOSTRADO ya arranca en el real (ver `valorMostrado` abajo) así que no
  // pasar por acá todavía no deja nada incorrecto en pantalla.
  const [reducido, setReducido] = useState<boolean | null>(null);

  useEffect(() => {
    let vivo = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (vivo) setReducido(v); })
      .catch(() => { if (vivo) setReducido(false); });
    return () => { vivo = false; };
  }, []);

  const absMinor = Math.abs(minor);
  const valorReal = code ? absMinor / minorFactor(code) : minor;

  const opciones: Intl.NumberFormatOptions = code
    ? (() => {
        const currency = getCurrency(code);
        // Misma regla que `formatAmount`: sin centavos en cero.
        const sinCentavos = currency.decimals === 0 || absMinor % minorFactor(code) === 0;
        const decimales = sinCentavos ? 0 : currency.decimals;
        return { minimumFractionDigits: decimales, maximumFractionDigits: decimales };
      })()
    : { useGrouping: false };

  const prefijoCompleto = code ? `${prefix}${getCurrency(code).symbol}` : prefix;

  // Texto de referencia: decide si el valor cambió de verdad (`debeRodar`) y
  // es el mismo que valida la paridad exacta con `formatMoney` en los tests.
  const texto = code ? `${prefix}${formatMoney(minor, code)}` : `${prefix}${minor}`;

  const primeraVezRef = useRef(true);
  const [valorMostrado, setValorMostrado] = useState(valorReal);

  useEffect(() => {
    if (reducido === null) return; // esperamos la respuesta real antes de decidir

    const cambio = debeRodar(registry, id, texto);

    if (primeraVezRef.current) {
      primeraVezRef.current = false;
      if (cambio && !reducido) {
        setValorMostrado(numeroSemilla(valorReal));
        const frame = requestAnimationFrame(() => setValorMostrado(valorReal));
        return () => cancelAnimationFrame(frame);
      }
      setValorMostrado(valorReal);
      return;
    }

    // Ya estaba montado: si cambió de verdad, alcanza con pisar el valor
    // mostrado — la librería anima el diff natural viejo→nuevo sola, sin
    // el truco de semilla (ese es sólo para la primera aparición).
    if (cambio) setValorMostrado(valorReal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, texto, reducido, registry]);

  return (
    <View testID={testID}>
      <NumberFlow
        value={valorMostrado}
        format={opciones}
        locales={getFormatLocale()}
        prefix={prefijoCompleto}
        style={StyleSheet.flatten(style)}
        animated={reducido !== true}
        respectMotionPreference
      />
    </View>
  );
}
