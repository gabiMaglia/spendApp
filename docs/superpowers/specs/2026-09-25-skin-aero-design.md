# Sistema de skins + skin "Aero" (piloto en Personal) — diseño

**Rama:** `feature/skin-aero` (desde `dev`) · **Fecha:** 2026-09-25
**Estado:** aprobado por el PO en chat; pendiente de revisión del documento.

## Objetivo

Agregar un segundo skin, **Aero** ("aero mármol soft glow"): más moderno, sutil, con aire, profundidad y
simetría, sin perder la esencia del look actual. El look actual ("bandas planas") pasa a ser el **skin
default y fallback**. El piloto aplica el Aero **solo a la pantalla Personal**.

## Decisiones del PO

1. Un skin define **colores, radios, sombras, brillos y cómo se dibuja una superficie**. No cambia la estructura de las pantallas.
2. **Fallback campo a campo:** un skin declara solo lo que cambia; lo que falta o es inválido se completa con el fallback. Si el skin elegido no existe o falla entero, se usa el fallback completo.
3. **El fallback es configuración del proyecto** (una constante), no un ajuste del usuario. Hoy es el skin actual.
4. **Alcance:** solo Personal. Sin funciones nuevas: se adapta lo que ya existe (header, navegador de mes, medidor de presupuesto, encabezado de Movimientos, filas, FAB). **Sin gráfico de torta** en esta entrega.
5. Activación: selector **"Estilo"** en la pantalla Yo, con la opción *Aero (vista previa)* que aclara que por ahora solo cambia Personal.
6. El Aero **define su propio fondo** (más frío). Durante el piloto se acepta el salto de fondo al cambiar de pestaña.

## Arquitectura

```
src/skins/
  types.ts         Skin (tokens) y SkinOverride (DeepPartial<Skin>)
  default.ts       skin actual, derivado de Colors / Spacing / Radius existentes
  aero.ts          SkinOverride: solo lo que cambia
  registry.ts      SKINS = { default, aero }, FALLBACK_SKIN = 'default'
  resolveSkin.ts   función pura: fallback + override, campo a campo
  useSkin.ts       lee settingsStore.skin + esquema; devuelve el Skin resuelto (+ `degradado`)
src/components/skin/   superficies reutilizables que leen useSkin()
```

- **`resolveSkin(id, esquema)`**: parte de una copia de `SKINS[FALLBACK_SKIN]` y aplica el override de `id` recursivamente. Un valor se acepta solo si tiene el mismo tipo que el del fallback (color = string no vacío, número finito, objeto); si no, queda el del fallback. `id` desconocido → fallback completo. Nunca lanza.
- **Migración no invasiva:** solo los componentes de Personal pasan a `useSkin()`. Los ~60 archivos restantes siguen con `Colors[scheme]` sin cambios.
- **Persistencia:** `settingsStore.skin: string` (clave con scope `skin`, default `FALLBACK_SKIN`), igual que `reduceAnimations`.

## Tokens del skin

`colors` (la paleta completa del esquema, más): `surfaceRaised`, `surfaceSunken`, `glow`, `glowStrong`, `edgeLight`, `edgeShade`, `marmolVeil`, `marmolOpacity` (número).
`elevation`: `e1`, `e2`, `e3`, cada uno `{ boxShadow: string; elevationFallback: number }`.
`radius`: `panel`, `row`, `chip`, `fab`. `space`: `inset`, `gapPanel`, `padPanel`, `gapSection`.
`flags.soft`: habilita sombras coloreadas, gradientes y halos.

El default reproduce exactamente el look actual: `soft: false`, sin sombras ni halo, radios 0 en paneles y hairlines como hoy.

### Valores del Aero (claro / oscuro)

- `bg` `#F1F3F6` / `#0C0E11` · `surface` `#FFFFFF` / `#171A1E` · `surfaceRaised` `#FFFFFF` / `#1E2227` · `surfaceSunken` `#EDF0F4` / `#121417`
- `glow` `rgba(58,74,94,0.14)` / `rgba(139,163,189,0.16)` · `glowStrong` 0.22 / 0.26
- `edgeLight` `rgba(255,255,255,0.90)` / `rgba(255,255,255,0.07)` · `edgeShade` `rgba(20,26,20,0.06)` / `rgba(0,0,0,0.35)`
- `marmolOpacity` 0.70 / 0.55 · `marmolVeil` `rgba(255,255,255,0.35)` / `rgba(15,17,18,0.30)`
- `textTertiary` claro `#6A7178` (el actual `#8B9299` no pasa AA sobre `#F1F3F6`)
- Elevación claro: e1 `0 1px 2px rgba(20,30,50,.06), 0 4px 12px rgba(20,30,50,.05)` · e2 `0 2px 4px rgba(20,30,50,.07), 0 10px 24px rgba(20,30,50,.09)` · e3 `0 4px 8px rgba(42,55,71,.18), 0 14px 28px rgba(58,74,94,.28)`. Oscuro: e1 `0 1px 2px rgba(0,0,0,.5)` · e2 `0 8px 20px rgba(0,0,0,.55)` · e3 igual que claro.
- Radios `panel 20 · row 16 · chip 12 · fab 18`. Espacio `inset 16 · gapPanel 12 · padPanel 16 · gapSection 20`.
- Marca, semánticos y tipografía: heredan del default.

## Superficies (`src/components/skin/`)

| Componente | Uso en Personal | Receta Aero |
|---|---|---|
| `Panel` | medidor, lista de movimientos | `surface`, radio `panel`, inset lateral, sombra `e1`/`e2`, filo `edgeLight` arriba. En default = `Band` actual |
| `MarmolPill` | navegador de mes, encabezado de Movimientos | `FondoMarmol` con `marmolOpacity` + `marmolVeil`, radio `panel`. Variante `sticky`: mármol opaco y sin sombra grande (la lista no debe transparentarse detrás) |
| `GlowMeter` | barra del presupuesto | alto 8, extremos redondeados, track `surfaceSunken`, relleno con gradiente SVG y halo del color de la barra |
| `SkinHalo` | detrás del header y del medidor | `react-native-svg` `RadialGradient` estático con `glow` |
| FAB | botón de alta | `e3` + `glowStrong`, gradiente sutil primary→primaryStrong |

Filas: un solo `Panel` contenedor con la sombra (nunca una sombra por fila) y separadores `edgeShade` con margen `inset`.
Sin dependencias nativas nuevas: `boxShadow` (RN 0.81 New Arch) y `react-native-svg` (ya instalado).

## Degradación

`degradado = !flags.soft || esDispositivoDeGamaBaja() || useAnimacionesReducidas() === true`. Con `degradado`:
sombras → `elevationFallback` + borde 1px; gradientes y halos → color plano; sin animación del halo.
Los montos van siempre sobre superficie sólida (nunca sobre mármol).

## Qué no se toca

Texturas de mármol, azul noche de marca, tipografía, semánticos (T-137), orden y jerarquía de Personal, encabezado sticky, `Segmented variant="tabs"`, tab bar.

## Ajustes al escribir el plan (2026-09-25)

Salieron de leer el código; no cambian ninguna decisión del PO:

- **Sin `SkinProvider`.** El skin elegido vive en `settingsStore` (Zustand ya es estado global), así que `useSkin()` lo lee directo. Un contexto extra no agrega nada.
- **Sin `react-native-svg`.** El dev client instalado ya falló con svg (`topSvgLayout`, T-138 / 2026-09-23). Gradientes con `experimental_backgroundImage` (RN 0.81 New Arch) y halos con `boxShadow` de color. `SkinHalo` desaparece: el halo es una segunda sombra del `Panel`.
- **El header compartido (`TabHeader`) no se toca.** Lo usan las cinco pestañas; el halo va en el medidor. El FAB lleva sombra y glow de marca, sin gradiente.
- `Band` lee un contexto de `Panel`: dentro de un panel del Aero pierde sus hairlines y su fondo, así `SplitStat` y `StatLead` quedan como contenido del panel sin modificarse.

## Selector en Yo

Sección existente de preferencias: fila "Estilo" con *Clásico* (default) y *Aero (vista previa)*, más el texto "Por ahora solo cambia la pantalla Personal". Claves i18n en es/en/pt.

## Testing (Jest, sin tests visuales)

- `resolveSkin`: override vacío = fallback; token faltante; valor de tipo inválido; id inexistente; no muta el fallback; claro/oscuro.
- `useSkin`: `degradado` según `soft`, gama baja y reducir animaciones.
- `settingsStore.skin`: default, persistencia, valor inválido guardado → fallback.
- Selector de Yo: tocar *Aero* cambia `settingsStore.skin`.
- Superficies: renderizan hijos y cambian de receta según `degradado` (comportamiento, no estilos).

## Fuera de alcance

Gráfico de torta, migrar otras pantallas, skins creados por el usuario, cambiar el fallback desde la UI, `expo-linear-gradient`/`expo-blur`.
