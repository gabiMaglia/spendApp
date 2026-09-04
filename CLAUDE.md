# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

## Proyecto: SplitP2P — Clon de Splitwise Serverless

App móvil de división de gastos (Expo / React Native) que funciona **100% sin backend central**. Toda la lógica corre en el dispositivo. Dos usuarios se sincronizan directamente entre sí (P2P). Ver `docs/ARCHITECTURE.md` para el diseño completo y `docs/FEATURES.md` para el roadmap de features.

### Stack elegido

| Capa | Tecnología |
|---|---|
| Framework | Expo SDK 54 + Expo Router v6 |
| Lenguaje | TypeScript estricto |
| Almacenamiento local | MMKV (rápido, sincrónico) + Zustand. **WatermelonDB se evaluó y se sacó el 2026-09-03** (decisión del PO): estuvo instalado seis semanas sin que nada lo importara. Si vuelve, es por una necesidad medida de queries reactivas, no por el plan viejo |
| OCR (Pro) | `@react-native-ml-kit/text-recognition` — on-device, offline, sin API key |
| Sincronización P2P | WebRTC (internet, auto) + relay cifrado (Supabase). **BLE está PLANEADO, no implementado** — no hay ninguna dependencia de Bluetooth en el proyecto (verificado 2026-09-02) |
| Autenticación | Expo Auth Session → Google OAuth + Sign in with Apple |
| Estado global | Zustand |
| i18n | `expo-localization` + `i18next` + `react-i18next` |
| Notificaciones | `expo-notifications` (locales, post-sync — sin Firebase ni push real) |
| UI | React Native StyleSheet + `ThemedText`/`ThemedView` existentes |
| Iconos | `IconSymbol` (SF Symbols en iOS, Material Icons en Android/Web) |

---

## Comandos

```bash
npx expo start           # Dev server (elige plataforma desde el menú)
npx expo start --ios
npx expo start --android
npx expo start --web
npm run lint             # ESLint vía expo lint
npm test                 # Jest
npm run test:watch       # Jest en modo watch
npm run test:coverage    # Jest con reporte de cobertura
npm test -- --testPathPattern=NombreDelTest   # un test específico
```

> Ejecutar `npx expo run:ios` o `npx expo run:android` para levantar con dev client.

---

## Internacionalización (i18n)

- Idioma por defecto: **español**.
- Idiomas soportados: español (`es`), inglés (`en`), portugués (`pt`).
- La preferencia del usuario se guarda en MMKV y se aplica al iniciar la app. Si no hay preferencia, se usa el idioma del dispositivo (`expo-localization`). Si el dispositivo no está en ninguno de los tres, se cae a español.
- **Ningún string visible al usuario va hardcodeado en JSX.** Todo pasa por `t('clave')` de i18next.
- Estructura de archivos:
  ```
  src/i18n/
    index.ts          ← configuración de i18next
    locales/
      es.json         ← español (fuente de verdad — crear primero)
      en.json
      pt.json
  ```
- Las claves se organizan por dominio: `expense.create`, `group.invite`, `balance.owes`, etc.
- En tests: mockear i18next para que devuelva la clave como string (`t('x') → 'x'`). Los tests nunca dependen de strings traducidos.

## Monedas soportadas

```typescript
// src/constants/currencies.ts
export const SUPPORTED_CURRENCIES = [
  { code: 'USD', symbol: '$',   name: 'Dólar estadounidense', decimals: 2 },
  { code: 'EUR', symbol: '€',   name: 'Euro',                 decimals: 2 },
  { code: 'ARS', symbol: '$',   name: 'Peso argentino',       decimals: 2 },
  { code: 'BRL', symbol: 'R$',  name: 'Real brasilero',       decimals: 2 },
  { code: 'CLP', symbol: '$',   name: 'Peso chileno',         decimals: 0 },
  { code: 'BOB', symbol: 'Bs.', name: 'Boliviano',            decimals: 2 },
  { code: 'PYG', symbol: '₲',   name: 'Guaraní paraguayo',    decimals: 0 },
  { code: 'UYU', symbol: '$U',  name: 'Peso uruguayo',        decimals: 2 },
  { code: 'PEN', symbol: 'S/',  name: 'Sol peruano',          decimals: 2 },
] as const;

export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number]['code'];
```

- El formateo de montos **siempre** usa `Intl.NumberFormat` con el `code` ISO y los `decimals` correspondientes. Nunca formatear a mano.
- CLP y PYG no usan decimales — el input numérico debe bloquearlo cuando se seleccionan.
- Los balances multi-moneda se muestran agrupados por código (nunca convertidos implícitamente).

---

## Reglas de código obligatorias

### Componentes reutilizables
Toda pieza de UI que se use más de una vez — o que represente una unidad de UI con lógica propia — **debe ser un componente separado** en `src/components/` o `components/`. Nunca duplicar JSX entre pantallas. Si algo se repite dos veces, se extrae.

### Testing con Jest — reglas estrictas
**Todo módulo de lógica y todo componente con comportamiento propio debe tener un test.**

Qué se testea:
- Lógica de negocio: `calculateBalances`, `simplifyDebts`, `mergeData`, `resolveDeletionVotes`, `buildSplits`, `requiresRewardedAd`, etc.
- Comportamiento de componentes: qué se renderiza según props, qué pasa al tocar un botón, qué muestra en estado vacío/error/loading.
- Hooks con lógica: retorno correcto según estado, side effects.

Qué **no** se testea:
- Tamaños (`width`, `height`, `fontSize`)
- Colores (`backgroundColor`, `color`)
- Márgenes y paddings
- Estilos visuales en general

Estructura de tests:
```
src/algorithms/__tests__/calculateBalances.test.ts
src/algorithms/__tests__/simplifyDebts.test.ts
src/sync/__tests__/SyncEngine.test.ts
src/components/__tests__/ExpenseCard.test.tsx
src/components/__tests__/GroupCard.test.tsx
```

Cada test debe cubrir:
1. El caso feliz (happy path)
2. Edge cases relevantes (lista vacía, valores 0, un solo miembro, etc.)
3. Comportamiento ante inputs inválidos cuando corresponda

---

## Arquitectura de código

### Routing (`app/`)

- `_layout.tsx` — Stack raíz, envuelve en `ThemeProvider`. Requiere auth antes de mostrar tabs.
- `(tabs)/_layout.tsx` — Navegador de tabs inferior.
- `modal.tsx` — Pantalla modal de ejemplo.

**Pantallas planeadas:**
```
app/
  auth/             ← Login con Google / Apple
  (tabs)/
    index.tsx       ← Dashboard de balances globales
    groups.tsx      ← Lista de grupos
    activity.tsx    ← Historial de actividad
  groups/[id].tsx   ← Detalle de grupo + gastos
  expense/new.tsx   ← Crear gasto
  expense/[id].tsx  ← Detalle / editar gasto
  settings.tsx      ← Plan free/pro, perfil
```

### Estructura de módulos

```
src/
  sync/             ← SyncEngine (merge CRDT, tombstones, delta)
  p2p/              ← emparejamiento WebRTC por QR (sdpCodec, usePairingSession). BLE no existe todavía
  auth/             ← useAuth hook (Google, Apple)
  store/            ← Zustand stores (groups, expenses, balances)
  algorithms/       ← calculateBalances(), simplifyDebts()
  services/
    ocr.ts          ← Escaneo de recibos (Pro)
    currency.ts     ← Conversión de divisas (Pro)
  components/       ← Componentes reutilizables de UI
```

### Path alias

`@/` mapea a la raíz del repo. Nunca usar rutas relativas con `../`.

### Theming

- Colores en `constants/theme.ts` (`Colors.light` / `Colors.dark`).
- `hooks/use-theme-color.ts` → resuelve color por nombre según el esquema actual.
- Usar `ThemedText` y `ThemedView` como primitivos base en toda la UI.

### Iconos (platform-split)

- iOS: `icon-symbol.ios.tsx` usa `expo-symbols` (SF Symbols nativo).
- Android/Web: `icon-symbol.tsx` mapea SF Symbol → Material Icons.
- Al agregar un ícono nuevo, siempre añadir su entrada en el `MAPPING` de `icon-symbol.tsx`.

### Archivos platform-specific

Expo resuelve `.ios.tsx` / `.web.ts` automáticamente. Seguir ese patrón para comportamiento específico por plataforma.

---

## Reglas de negocio críticas

1. **Tombstones obligatorios**: Nunca hacer DELETE físico. Siempre `isDeleted: true` + `updatedAt` actualizado.
2. **Borrado consensuado con override del creador**: El creador del gasto puede forzar el borrado. Los demás tienen 72hs para objetar. Ver `docs/ARCHITECTURE.md#deletion-consensus`.
3. **Borrar ≠ liquidar**: Son dos acciones con lógica distinta y **ninguna de las dos es libre en un grupo `consensus`**. Esta regla decía «liquidar una deuda no necesita consenso» hasta el 2026-09-01, y el PO la invirtió: en un grupo consensuado, quien COBRA tiene que acusar recibo antes de que el saldado se efectivice (T-064). El acuse va firmado y se une en el merge, como los votos de borrado — no es un campo de estado, porque un campo lo pisa el LWW (es la trampa de T-053). Mientras espera, la deuda **no figura ni viva ni saldada**: quien ya transfirió la plata no queda de deudor, y quien cobra tiene el aviso `settlement_pending` esperándolo. **No hay plazo automático**: el silencio no consiente, a diferencia del borrado. Por eso el RECHAZO es obligatorio y no opcional — es lo único que devuelve la deuda a la vida si el pago nunca existió. En un grupo `open` no cambia nada. Ver `engram/plans/T-064.md` y `docs/ARCHITECTURE.md#debt-settlement`.
4. **Last-Write-Wins por `updatedAt`**: En conflictos de merge, gana el registro con mayor timestamp.
5. **IDs generados en cliente**: Todos los `id` son UUIDs generados en el dispositivo, nunca en servidor.
6. **Monetización por ads**: Primeros 4 gastos del día gratis. A partir del 5to, rewarded ad por cada gasto. Pro = sin ads + sin límite.
7. **Multi-moneda**: Los balances se muestran separados por currency code, nunca se mezclan. Al liquidar, el usuario elige la moneda de pago (Free: tipo de cambio manual; Pro: automático).
8. **Sync por grupo, con ESTADO — no con delta por fecha**: al sincronizar se publica el estado **completo** del grupo, filtrado por `groupId` (`buildGroupPayload`). **NO hay filtro por `updatedAt > lastSyncTimestamp`, y no debe haberlo.** Esta regla decía lo contrario hasta el 2026-08-31 y era falsa desde hacía tiempo: mandó a dos tickets por el camino equivocado antes de que alguien fuera a verificarla. El sobre lleva estado a propósito, y **tres** mecanismos dependen de eso — la compactación del buzón (`supabase/004_compaction.sql:10-14` advierte textual que volverla incremental la convierte en «pérdida de datos silenciosa»), el TTL de 30 días, y el descarte barato de sobres. Es además lo que satisface la promesa de que quien entra tarde a un grupo ve **todo** el historial, sin tener que entregarle claves viejas (`engram/02_architecture.md:659`). El costo de esto es real y está abierto en **T-058**: el sobre crece O(gastos) y ya se pasa del tope en un grupo ordinario.
9. **Invitación en 3 formas**: QR presencial, deep link (expira 48hs), username (solo para peers conocidos).
10. **Sync automática**: Al abrir la app, al recuperar internet, cada 15min en primer plano. P2P via Google STUN / Open Relay TURN.

---

## Documentación de referencia

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Motor P2P, protocolo de sync, modelo de datos TypeScript
- [docs/FEATURES.md](docs/FEATURES.md) — Matrix free/pro, fases de construcción, lógica de borrado consensuado
- [docs/ALGORITHMS.md](docs/ALGORITHMS.md) — Balance calculation, simplificación de deudas (Greedy)
