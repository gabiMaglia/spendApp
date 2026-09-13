# Fase 1 — Endurecimiento antes de invitar a nadie

**Fecha:** 2026-09-12 · **Estado:** diseño aprobado por el PO («si») · **Roadmap:** `engram/10_roadmap_beta.md` Fase 1
**Origen:** auditoría pre-lanzamiento — `engram/qa/SEC-links-2026-09-12.md` (M-1, M-2, L-1..L-4) y `engram/qa/AUDIT-build-prod-2026-09-12.md`.
**Tickets:** T-094 · T-095 · T-099 · T-098. **Fuera:** T-096, T-097 (Fase 3), T-101 (⏸️ en espera).

## Reglas comunes
- Agente: `nerv-mobile`. QA: `nerv-qa` nivel Standard. **Proof of red** documentado por criterio (revertir el fix ⇒ cae su test).
- Sin dependencias nativas nuevas. Si alguna resulta necesaria, se frena y se reporta.
- i18n es/en/pt, alias `@/`, UI repetida → componente. Suite completa, `tsc --noEmit` 0, lint 0 errores.
- Nunca leer valores de variables de entorno ni correr `eas env:list`.
- Orden: **T-095 → T-094** (los dos tocan `app/_layout.tsx`, en secuencia) · **T-099 y T-098** en paralelo con ellos.

---

## T-094 · El link pendiente no se reabre en otra cuenta (M-1)

**Problema.** `Linking.useURL()` conserva la última URL recibida. El efecto de `app/_layout.tsx:99-103` depende de `currentUser`: al cerrar sesión vuelve a correr con `currentUser = null` y la URL vieja, y `recordarEnlace` la guarda como pendiente. El próximo login —de cualquier cuenta— la abre.

**Diseño.**
1. `AuthGuard` deja de usar `Linking.useURL()`. En su lugar:
   - `Linking.getInitialURL()` **una sola vez** al montar (arranque en frío por link).
   - `Linking.addEventListener('url', …)` para los links que llegan con la app viva.
   - Cada URL recibida se evalúa **en el momento en que llega**: sin sesión ⇒ `recordarEnlace(url)`; con sesión ⇒ se marca consumida (la abre expo-router, no hace falta pendiente).
2. `src/utils/enlacePendiente.ts` suma `marcarConsumido(url)` y `descartarEnlacePendiente()`.
3. `signOut` y el cambio de cuenta (`src/store/authStore.ts`) llaman `descartarEnlacePendiente()`.
4. El estado de sesión se lee al momento del evento (ref o `useAuthStore.getState()`), no desde el closure del efecto, para que el listener no quede con una sesión vieja.

**Criterios de aceptación.**
1. Link abierto con sesión → logout → login de otra cuenta ⇒ **no** se navega a ningún link.
2. Link sin sesión (frío o en caliente) → login ⇒ se abre **una** vez; un segundo login no lo repite.
3. Logout con un pendiente guardado ⇒ el pendiente se descarta.
4. Links que llegan con sesión siguen abriéndose como hoy (sin regresión de T-093: pasan por la confirmación).

**Tests.** `src/utils/__tests__/enlacePendiente.test.ts` (funciones nuevas) y un test del `AuthGuard` con `expo-linking` simulado que recorra los casos 1-3.

---

## T-095 · La lista blanca de rutas también rige con sesión (M-2)

**Problema.** `RUTAS_ENLAZABLES` sólo filtra la página trampolín y el camino sin sesión. Con sesión, `spendapp://debug/identity`, `spendapp://settings/borrar-cuenta`, `spendapp://settle/new?…` o `spendapp://groups/leave?…` abren directo desde cualquier web o app.

**Diseño.**
1. `app/+native-intent.tsx` con `redirectSystemPath({ path, initial })` (API de Expo Router v6 — verificar firma en la documentación de SDK 54 antes de escribir): toda URL externa pasa por `hrefInterno` de `src/utils/appLink.ts`. Si devuelve `null` ⇒ `'/'`. Si es enlazable ⇒ la ruta interna que devuelve `hrefInterno`.
2. Defensa en profundidad: `app/debug/identity.tsx` y `app/debug/relay.tsx` devuelven `<Redirect href="/" />` cuando `!__DEV__`. La lógica de decisión va en una función pura (p. ej. `pantallaDebugHabilitada(isDev)`) para poder testearla.

**Criterios de aceptación.**
1. `spendapp://debug/identity`, `spendapp://debug/relay`, `spendapp://settings/borrar-cuenta`, `spendapp://settle/new?toId=x`, `spendapp://groups/leave?id=x` ⇒ `'/'`.
2. `spendapp://contact/add?…`, `spendapp://groups/join?…` y las formas compactas (`spendapp://c…`, `spendapp://g…`) ⇒ su ruta interna, sin cambios de comportamiento.
3. Una URL basura o vacía ⇒ `'/'`, sin excepción.
4. En producción (`__DEV__ = false`) las pantallas de debug no se renderizan.
5. La navegación interna de la app (`router.push`) no pasa por este filtro y no cambia.
6. No rompe URLs que no son links de la app: el redirect de Google Sign-In (`com.googleusercontent.apps…`), el de Apple, y el dev client (`exp+spendapp://expo-development-client/…`) en desarrollo. Antes de escribir el filtro, listar qué URLs recibe realmente `redirectSystemPath` en esos flujos; si alguna debe pasar intacta, se deja pasar explícitamente y se testea.

**Tests.** `app/__tests__/nativeIntent.test.ts` (o junto a los de `appLink`) sobre la función que decide la redirección; test de la función pura de las pantallas de debug.

---

## T-099 · El build no sale sin configuración, y la app lo dice (AUDIT build §1)

**Problema.** Si al build le faltan `EXPO_PUBLIC_SUPABASE_URL` o `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `isRelayConfigured()` da `false` y `src/sync/relayEngine.ts:129` retorna sin hacer nada: la app abre, guarda gastos y nunca sincroniza. El único indicador está en `app/debug/identity.tsx`, detrás de `__DEV__`.
**Agravante encontrado en el diseño:** sin buzón configurado, `src/store/authStore.ts:240` **fusiona cuentas sin probar el proveedor** (está declarado en el comentario). Un build de producción sin variables también abre ese camino.

**Diseño.**
1. `scripts/verificar-env-build.js` exporta una función pura `faltantes(env, perfil): string[]` y un `main` que:
   - Sale con 0 si `EAS_BUILD` no está definido (builds locales y `expo start` no se afectan).
   - Con perfil `production` o `preview` (`EAS_BUILD_PROFILE`), si falta alguna de las 4 variables (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB`, `EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS`) o está vacía, imprime **sólo los nombres** faltantes y sale con 1.
   - `development` no se chequea.
   - **Nunca** imprime, loguea ni compara contra un valor.
2. `package.json`: `"eas-build-post-install": "node scripts/verificar-env-build.js"`.
3. Pestaña **Yo** (`app/(tabs)/user.tsx`), en la sección de estado: fila «Sincronización no disponible» visible cuando `!isRelayConfigured()`, **fuera** de `__DEV__`. Con configuración presente no aparece nada. Claves i18n nuevas en es/en/pt. (Decisión del PO: sólo en Yo, sin banner en Grupos.)

**Criterios de aceptación.**
1. `faltantes` devuelve exactamente los nombres ausentes o vacíos; lista vacía si están las 4; no se ejecuta fuera de EAS; `development` no chequea.
2. La salida del script no contiene ningún valor (test: con valores centinela en el entorno, la salida no los incluye).
3. La fila de Yo aparece con relay sin configurar y no aparece con relay configurado.

**Tests.** `scripts/__tests__/verificarEnvBuild.test.js` (o `.ts` si jest lo toma) y test de la fila en la pantalla Yo.

---

## T-098 · Lote de hallazgos bajos (L-1..L-4)

### L-1 · `docs/web/abrir.html`
1. En formato largo, la query se acepta sólo si cumple `^[A-Za-z0-9%._~=&+-]*$`; si no, la página muestra el estado de link inválido (ya existe).
2. `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-…'; style-src 'sha256-…'; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">`. Si el estilo es inline con atributo `style=`, moverlo a `<style>` o sumar su hash.
3. `src/__tests__/paginaAbrir.test.ts` recalcula el hash del script y del estilo inline y exige que coincidan con los de la CSP. Cambiar el script sin actualizar la CSP rompe el test.
4. Tras el merge, el Orquestador republica con `scripts/publicar-sitio.sh` y verifica en vivo.

### L-2 · Formato largo validado
`contactFromParams` (`src/utils/contactLink.ts`) e `inviteFromParams` (`src/sync/groupInvite.ts`) reusan los validadores del compacto (`src/utils/linkCompacto.ts`): claves = hex de 32 bytes, `e` = entero seguro ≤ 2^48, largos de token y fingerprint exactos. Un campo inválido ⇒ el link completo se rechaza (`null`), igual que el compacto. El formato largo **se sigue leyendo**: es también el respaldo cuando el compacto no puede representar un campo.

### L-3 · Entradas hostiles
1. Tope de **600 caracteres** del código antes de decodificar (compacto) y de la URL entera (largo).
2. Nombre: ≤ 64 code points y sin caracteres de categoría Cc/Cf (incluye NUL y RLO). Nombre inválido ⇒ link rechazado.
3. `listPeers` (`src/sync/contactChannel.ts:508`) devuelve un objeto con prototipo nulo; `getPeer('constructor')` y `getPeer('__proto__')` ⇒ `undefined`.
4. base64url canónico: bits sobrantes en cero; `AQ` y `AR` no decodifican a lo mismo.
5. Id numérico canónico: sin ceros a la izquierda.
6. **No** se restringen los ids a UUID o número: los ids de Apple son texto con puntos.

### L-4 · Invitaciones por cuenta
`invites_v1` y `pending_joins_v1` (`src/store/identityStore.ts`) pasan a `readScoped`/`writeScoped` (`src/store/userScope.ts`). Las privadas del aparato (`identity_v1`, `wrapkeys_v1`, `owner_secret_v1`) **siguen sin scopear**, a propósito (ver comentario del archivo). Migración: al primer acceso con cuenta activa, si existe la clave sin scope y no la scopeada, se mueve a la cuenta activa y se borra la vieja.

### Criterios de aceptación del lote
1. Cada punto de L-1..L-4 tiene al menos un test que cae si se revierte (proof of red).
2. Los links compactos y largos que ya funcionan siguen funcionando (tests existentes de `appLink`, `contactLink`, `groupInvite`, `linkCompacto` verdes sin cambiar sus expectativas, salvo casos hostiles nuevos).
3. Una invitación emitida por la cuenta A no se procesa con la cuenta B activa; tras la migración, A conserva sus invitaciones.

### Fuera del código (PO)
2FA obligatorio y protección de rama en la org `spendapp` (repo `spendapp.github.io`) y en el repo personal viejo que todavía publica `gabimaglia.github.io/spendApp`.

---

## Lo que esta fase no verifica
- Nada en aparato: la navegación real de `+native-intent` con un link de otra app, y el comportamiento de `getInitialURL` en arranque en frío, van al anexo `engram/qa/AUDIT-device-2026-09-12.md` (A.2-A.4) en la Fase 2.
- El guard de build sólo se ve funcionar en un build real de EAS (Fase 2).
