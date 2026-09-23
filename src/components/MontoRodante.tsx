import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet, Text, View, type StyleProp, type TextStyle,
} from 'react-native';
import { NumberFlow } from 'number-flow-react-native';
import { Easing } from 'react-native-reanimated';

import {
  formatMoney, getCurrency, getFormatLocale, minorFactor, type CurrencyCode,
} from '@/src/constants/currencies';
import {
  debeRodar, numeroSemilla, proximoRetrasoDeEntrada, registroDeMontosDeLaApp,
  type MontoRegistry,
} from '@/src/utils/montoRodanteRegistry';
import { useAnimacionesReducidas } from '@/src/hooks/useAnimacionesReducidas';

/**
 * Timing más corto que el default de la librería (~900ms — ver
 * `node_modules/number-flow-react-native/src/core/timing.ts`,
 * `DEFAULT_TRANSFORM_TIMING`/`DEFAULT_SPIN_TIMING`, y los tipos públicos
 * `AnimationConfig` en `lib/typescript/core/types.d.ts`): el PO reportó FPS
 * bajos en iPhone 13 y Android de gama baja probando la versión con el
 * default. Menos tiempo de trabajo por columna sin perder la sensación de
 * "rueda" (T-106).
 */
const TIMING_RAPIDO = { duration: 350, easing: Easing.out(Easing.cubic) };

/**
 * Semilla NEUTRA (T-109) — a diferencia de `numeroSemilla` (dígitos
 * invertidos, que arma un número que PARECE un monto real), `0` no se puede
 * confundir con un dato: es la posición de arranque de un odómetro. Se usa
 * cuando el arranque involucra una conversión de moneda (viniendo de
 * `pending` o de un cambio de `code`), donde ANIMAR desde un número
 * inventado violaría "nunca dibujar una cifra que no sea la final".
 */
const SEMILLA_NEUTRA = 0;

type MostradoState =
  | { tipo: 'placeholder' }
  | {
      tipo: 'valor';
      value: number;
      format: Intl.NumberFormatOptions;
      prefix: string;
      /** SÓLO la moneda (no el signo `+`/`-` de `prefix`, que puede cambiar
       *  con normalidad al cruzar cero sin que eso sea una conversión). Sirve
       *  para detectar un cambio de MONEDA específicamente — ver `necesitaPlaceholder`. */
      moneda: CurrencyCode | undefined;
      /** Cambia sólo cuando hace falta forzar un remount limpio de `NumberFlow`
       *  (ver comentario en el efecto) — usada como `key`. */
      instancia: number;
    };

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
  /**
   * **Conversión de moneda en curso** (T-109). Mientras es `true` se muestra
   * un placeholder `--` en vez de animar hacia un total parcial (el bug
   * reportado: primero un monto sin convertir/incompleto, después el real —
   * dos animaciones y un número intermedio incorrecto). No se toca el
   * registro mientras tanto: cuando `pending` pasa a `false`, cuenta como
   * primera aparición de verdad. Nunca para "la tasa no existe" (eso sigue
   * siendo `UnconvertedNotice`) — sólo para "todavía no sabemos".
   */
  pending?: boolean;
  /**
   * Texto YA traducido por quien llama (ninguna reusable llama `t()`) para el
   * `accessibilityLabel` del placeholder — p.ej. `t('fx.calculating')`.
   * Requerido cuando `pending` es `true`.
   */
  pendingAccessibilityLabel?: string;
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
 * (0→0 no es un cambio). Por eso, en la primera aparición SIN conversión de
 * moneda de por medio, se monta con `numeroSemilla` (dígitos invertidos) y
 * al frame siguiente se pasa al real.
 *
 * **T-109 — nunca un frame con moneda mezclada.** `format`/`prefix` (derivan
 * de `code`) y `value` (deriva de `minor`) NO se leen directo de las props en
 * el render de `NumberFlow`: viven juntos en un solo estado (`mostrado`) que
 * se actualiza de UNA sola vez. Sin esto, un cambio de `code` hacía que
 * `NumberFlow` recibiera en el MISMO render el símbolo/formato NUEVO con el
 * `value` VIEJO (todavía no actualizado por el efecto) — el símbolo cambiaba
 * antes que el número, mostrando un monto que nunca existió. Ahora, cuando el
 * prefijo detectado en `mostrado` difiere del que piden las props actuales,
 * se pasa a `{ tipo: 'placeholder' }` EN EL MISMO RENDER (no en un efecto) y
 * recién el efecto arma el paquete nuevo completo (`value`+`format`+`prefix`)
 * de una vez, con una `key` nueva (`instancia`) para que `NumberFlow` monte
 * una instancia limpia — sin arrastrar ningún estado interno de la moneda
 * anterior. La reaparición usa la semilla NEUTRA (`0`), no `numeroSemilla`:
 * animar con un número inventado seguiría violando la regla.
 *
 * Con "reducir movimiento" (`respectMotionPreference`, built-in de la
 * librería + gate propio para no aplicar ninguna semilla) se muestra el
 * valor final directo.
 */
function MontoRodanteInterno({
  id, minor, code, prefix = '', style, testID, registry = registroDeMontosDeLaApp,
  pending = false, pendingAccessibilityLabel,
}: MontoRodanteProps) {
  // `null` = todavía no sabemos (la consulta de accesibilidad es async).
  // Arrancar en `false` por default causaba que la primera aparición SIEMPRE
  // aplicara una semilla antes de que la consulta real resolviera, incluso
  // con "reducir movimiento" activado — se detectó con el propio test.
  //
  // Fuente única (PO 2026-09-22): antes esta consulta vivía sólo acá; ahora
  // `useAnimacionesReducidas` también suma el toggle manual "Reducir
  // animaciones" de Yo (ver `settingsStore`), sin cambiar en nada esta lógica.
  const reducido = useAnimacionesReducidas();

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
  const instanciaRef = useRef(0);
  // Por qué se está mostrando el placeholder ahora mismo — decide CÓMO se
  // revela el valor final cuando el efecto lo resuelva. Son dos reglas
  // distintas del PO y no se pueden confundir:
  //   'pending'  → viene de una conversión de moneda EN VUELO (prop externa).
  //                Innegociable: la secuencia tiene que ser exactamente
  //                `[--, valorFinal]`, CERO valores intermedios — ni siquiera
  //                una semilla neutra cuenta como "seguro" acá.
  //   'moneda'   → el `code` cambió mientras ya había un valor mostrado (fue
  //                el bug reportado en el teléfono: el símbolo cambiaba antes
  //                que el número). Acá SÍ se pide "un solo giro" visible —
  //                semilla NEUTRA (nunca la clásica) y remount limpio.
  const razonPlaceholderRef = useRef<'pending' | 'moneda' | null>(pending ? 'pending' : null);

  const [mostrado, setMostrado] = useState<MostradoState>(() => (
    pending
      ? { tipo: 'placeholder' }
      : { tipo: 'valor', value: valorReal, format: opciones, prefix: prefijoCompleto, moneda: code, instancia: 0 }
  ));

  // Corrección EN RENDER (patrón oficial de React para derivar estado de
  // props antes de pintar, no en un efecto — evita el frame de por medio):
  // si la MONEDA actual no es la que ya está mostrada, hay una conversión en
  // curso (recién detectada) y hay que esconder el valor viejo YA, en este
  // mismo render — nunca dejar que `NumberFlow` reciba el símbolo nuevo junto
  // al valor viejo. Se compara `moneda` (código), no `prefix` entero: el
  // signo `+`/`-` de `prefix` puede cambiar solo (un saldo que cruza cero)
  // sin que eso sea una conversión — ese caso sigue el camino normal de
  // T-106 (roll natural en la misma instancia), no el remount de acá.
  const necesitaPlaceholder = pending
    || (mostrado.tipo === 'valor' && mostrado.moneda !== code);
  if (necesitaPlaceholder && mostrado.tipo !== 'placeholder') {
    razonPlaceholderRef.current = pending ? 'pending' : 'moneda';
    setMostrado({ tipo: 'placeholder' });
  }

  useEffect(() => {
    if (reducido === null) return; // esperamos la respuesta real antes de decidir
    // T-109: mientras la conversión de moneda está en curso, no se toca el
    // registro (no cuenta como "visto") ni se arma ningún valor — el efecto
    // vuelve a correr cuando `pending` pase a `false`.
    if (pending) return;

    const cambio = debeRodar(registry, id, texto);
    const veniaDePlaceholder = mostrado.tipo === 'placeholder';
    const esPrimeraVezDeVerdad = primeraVezRef.current;
    primeraVezRef.current = false;

    if (!cambio && !veniaDePlaceholder) return; // nada que hacer

    if (!veniaDePlaceholder && !esPrimeraVezDeVerdad) {
      // Camino de siempre (T-106): misma moneda, el valor cambió estando ya
      // montado — la librería anima el diff natural sola, sin semilla ni remount.
      setMostrado({ tipo: 'valor', value: valorReal, format: opciones, prefix: prefijoCompleto, moneda: code, instancia: instanciaRef.current });
      return;
    }

    // Se está revelando un valor tras el placeholder: `instancia` nueva para
    // que `NumberFlow` monte de cero (sin memoria de la moneda/valor viejo).
    instanciaRef.current += 1;
    const instancia = instanciaRef.current;
    const razon = razonPlaceholderRef.current;
    razonPlaceholderRef.current = null;

    if (razon === 'pending') {
      // Innegociable: cero intermedios, ni siquiera una semilla neutra.
      setMostrado({ tipo: 'valor', value: valorReal, format: opciones, prefix: prefijoCompleto, moneda: code, instancia });
      return;
    }

    if (razon === 'moneda') {
      // Un solo giro desde la semilla NEUTRA (nunca la clásica: sería un
      // número que se PARECE a un monto real) hasta el valor final.
      const necesitaVuelta = SEMILLA_NEUTRA !== valorReal && !reducido;
      setMostrado({ tipo: 'valor', value: necesitaVuelta ? SEMILLA_NEUTRA : valorReal, format: opciones, prefix: prefijoCompleto, moneda: code, instancia });
      if (!necesitaVuelta) return;
      const timer = setTimeout(
        () => setMostrado(m => (m.tipo === 'valor' ? { ...m, value: valorReal } : m)),
        proximoRetrasoDeEntrada(),
      );
      return () => clearTimeout(timer);
    }

    // Sin `pending` ni cambio de moneda de por medio: la primerísima
    // aparición clásica de T-106 (dígitos invertidos) — la única situación
    // donde "un número que se parece a un monto" es aceptable, porque no hay
    // ningún monto anterior real con el que se pueda confundir.
    const usarSemillaClasica = esPrimeraVezDeVerdad && !reducido;
    const semilla = usarSemillaClasica ? numeroSemilla(valorReal) : valorReal;
    const necesitaVuelta = semilla !== valorReal && !reducido;

    setMostrado({ tipo: 'valor', value: necesitaVuelta ? semilla : valorReal, format: opciones, prefix: prefijoCompleto, moneda: code, instancia });

    if (!necesitaVuelta) return;

    // Escalonado (T-109, FPS bajos): si varios montos se revelan en el mismo
    // tick (abrir Home/Personal), no todos flipean a la vez — se reparte un
    // turno creciente por lote.
    const timer = setTimeout(
      () => setMostrado(m => (m.tipo === 'valor' ? { ...m, value: valorReal } : m)),
      proximoRetrasoDeEntrada(),
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, texto, reducido, registry, pending, prefijoCompleto]);

  if (mostrado.tipo === 'placeholder') {
    return (
      <View testID={testID}>
        <Text
          accessibilityLabel={pendingAccessibilityLabel}
          style={StyleSheet.flatten(style)}
        >
          --
        </Text>
      </View>
    );
  }

  return (
    <View testID={testID}>
      <NumberFlow
        key={mostrado.instancia}
        value={mostrado.value}
        format={mostrado.format}
        locales={getFormatLocale()}
        prefix={mostrado.prefix}
        style={StyleSheet.flatten(style)}
        animated={reducido !== true}
        respectMotionPreference
        spinTiming={TIMING_RAPIDO}
        transformTiming={TIMING_RAPIDO}
        // `mask` (fade en los bordes): prop real y documentada
        // (`AnimationBehaviorProps.mask`, default `true`). Desactivarla es
        // gratis acá: `node_modules/number-flow-react-native/src/native/
        // MaskedView.tsx` sólo resuelve una implementación nativa si el
        // proyecto tiene `@rednegniw/masked-view` o `@expo/ui` instalados
        // (no es el caso — ninguno está en package.json), así que HOY el
        // masking ya cae al fallback sin vista extra. Con `mask` en `true`
        // igual se ejecuta `computeAdaptiveMaskHeights` en cada layout
        // (`core/useFlowPipeline.ts:124-128`) y se arma (y descarta) un árbol
        // de hasta 96 Views en `GradientMask.tsx` (`buildFallbackMaskElement`)
        // que nunca se monta. `false` se salta las dos cosas sin cambiar nada
        // visible en este proyecto.
        mask={false}
      />
    </View>
  );
}

// Memoizado (T-109, FPS bajos): las pantallas que usan `MontoRodante`
// (Home/Personal/Amigos) se re-renderizan seguido por cambios de store que no
// tocan este monto (otro grupo, otro gasto). Sin memo, cada uno de esos
// re-renders reformatea con `Intl.NumberFormat` y vuelve a montar el árbol de
// `NumberFlow` con las mismas props — trabajo de sobra en gama baja.
export const MontoRodante = React.memo(MontoRodanteInterno);
