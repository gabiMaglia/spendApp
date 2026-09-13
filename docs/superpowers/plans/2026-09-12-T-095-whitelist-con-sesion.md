# T-095 · La lista blanca de rutas también rige con sesión — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que ninguna URL externa `spendapp://…` abra una pantalla fuera de `RUTAS_ENLAZABLES`, y que las pantallas de debug no se rendericen en producción.

**Architecture:** Expo Router v6 llama a `redirectSystemPath({ path, initial })` exportado desde `app/+native-intent.tsx` para cada URL que llega del sistema. Ese archivo delega en una función pura `destinoDeUrlExterna(path)` (en `src/utils/`) que pasa las URLs de la app por `hrefInterno` y deja intactas las de otros esquemas. Aparte, un componente `SoloEnDesarrollo` envuelve las dos pantallas de debug y redirige a `/` cuando `__DEV__` es `false`.

**Tech Stack:** Expo SDK 54, Expo Router v6 (`+native-intent`), TypeScript estricto, Jest (`jest-expo`) + `@testing-library/react-native`.

**Spec:** `docs/superpowers/specs/2026-09-12-fase1-endurecimiento-links-design.md` (sección T-095).

## Global Constraints
- Agente: `nerv-mobile`. QA: `nerv-qa` Standard. **Proof of red** documentado por criterio.
- Sin dependencias nativas nuevas.
- Alias `@/`, nunca `../`. i18n es/en/pt para cualquier texto visible (esta tarea no agrega textos).
- Suite completa verde, `npx tsc --noEmit` 0 errores, `npm run lint` 0 errores.
- Nunca leer valores de variables de entorno ni correr `eas env:list`.
- Rama: `fix/T-095-whitelist-con-sesion` desde `main`. Commits terminados en `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. No mergear ni pushear (lo hace el Orquestador tras QA).
- Va **antes** que T-094 (los dos tocan el arranque por links).

## File Structure
- Create `src/utils/intencionNativa.ts` — `destinoDeUrlExterna(path: string): string`, pura.
- Create `src/utils/__tests__/intencionNativa.test.ts`.
- Create `app/+native-intent.tsx` — exporta `redirectSystemPath` que delega.
- Create `src/components/SoloEnDesarrollo.tsx` — `<SoloEnDesarrollo isDev?>`.
- Create `src/components/__tests__/SoloEnDesarrollo.test.tsx`.
- Modify `app/debug/identity.tsx`, `app/debug/relay.tsx` — default export envuelto.

---

### Task 1: Relevar qué URLs recibe `redirectSystemPath` (criterio 6)

**Files:** ninguno (investigación; el resultado va al mensaje del commit de la Task 2).

- [ ] **Step 1: Leer la documentación versionada**

Abrir https://docs.expo.dev/versions/v54.0.0/ → Router → Advanced → Native intent, y `node_modules/expo-router/build/types.d.ts:28-45`. Confirmar la firma `redirectSystemPath({ path, initial }): string | Promise<string>` y si `path` llega como URL completa (`spendapp://contact/add?…`) o como ruta (`/contact/add?…`).

- [ ] **Step 2: Buscar dónde la invoca expo-router**

Run: `grep -rn "redirectSystemPath" node_modules/expo-router/build/*.js node_modules/expo-router/build/**/*.js | head`
Anotar: (a) si se llama con la URL inicial y con cada evento `url`; (b) qué hace si la función lanza.

- [ ] **Step 3: Listar URLs de otros flujos**

Run: `grep -n "iosUrlScheme\|scheme" app.json`
Esperado: `"scheme": "spendapp"` y el `iosUrlScheme` de Google (`com.googleusercontent.apps…`). Apple Sign-In no usa URL de retorno. El dev client usa `exp+spendapp://expo-development-client/…`.
Conclusión que la Task 2 codifica: **sólo se filtran** URLs que empiezan con `spendapp:` o con `/`; toda otra URL (Google, dev client, https) pasa intacta, salvo https de `BASES_ACEPTADAS`, que se traduce con `hrefInterno`.

### Task 2: `destinoDeUrlExterna` y `+native-intent`

**Files:**
- Create: `src/utils/intencionNativa.ts`
- Create: `app/+native-intent.tsx`
- Test: `src/utils/__tests__/intencionNativa.test.ts`

**Interfaces:**
- Consumes: `hrefInterno(url: string): string | null` de `@/src/utils/appLink` (existe, `src/utils/appLink.ts:103`).
- Produces: `destinoDeUrlExterna(path: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/__tests__/intencionNativa.test.ts
import { destinoDeUrlExterna } from '@/src/utils/intencionNativa';
import { enlaceCompacto } from '@/src/utils/appLink';

/**
 * **La lista blanca también rige con sesión** (T-095 · SEC M-2).
 *
 * Con sesión, expo-router abría cualquier `spendapp://…`: una web podía mandar a
 * `debug/identity` (con «borrar todo») o a `settings/borrar-cuenta`.
 */
describe('destinoDeUrlExterna', () => {
  it.each([
    'spendapp://debug/identity',
    'spendapp://debug/relay',
    'spendapp://settings/borrar-cuenta',
    'spendapp://settle/new?toId=x&maxAmount=999',
    'spendapp://groups/leave?id=x',
    '/debug/identity',
    '/settings/borrar-cuenta',
  ])('una ruta no enlazable va al inicio: %s', (url) => {
    expect(destinoDeUrlExterna(url)).toBe('/');
  });

  it('los links de la app siguen abriendo su pantalla', () => {
    expect(destinoDeUrlExterna('spendapp://contact/add?id=u1&name=Ada')).toBe('/contact/add?id=u1&name=Ada');
    expect(destinoDeUrlExterna('spendapp://groups/join?g=g1&t=abc&e=1')).toBe('/groups/join?g=g1&t=abc&e=1');
    expect(destinoDeUrlExterna('/contact/add?id=u1&name=Ada')).toBe('/contact/add?id=u1&name=Ada');
  });

  it('las formas compactas y el https de la página también', () => {
    expect(destinoDeUrlExterna('spendapp://cABC_-')).toBe('/contact/add?c=ABC_-');
    expect(destinoDeUrlExterna(enlaceCompacto('g', 'XYZ'))).toBe('/groups/join?c=XYZ');
  });

  it.each(['', '/', 'spendapp://', 'spendapp:', 'spendapp://%%%'])('basura o vacío va al inicio sin lanzar: %j', (url) => {
    expect(destinoDeUrlExterna(url)).toBe('/');
  });

  it('no toca URLs que no son de la app (login de Google, dev client)', () => {
    const google = 'com.googleusercontent.apps.123-abc:/oauth2redirect?code=x';
    const devClient = 'exp+spendapp://expo-development-client/?url=http%3A%2F%2F192.168.0.2%3A8081';
    expect(destinoDeUrlExterna(google)).toBe(google);
    expect(destinoDeUrlExterna(devClient)).toBe(devClient);
  });

  it('un valor que no es string no rompe', () => {
    expect(destinoDeUrlExterna(undefined as unknown as string)).toBe('/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/utils/__tests__/intencionNativa.test.ts`
Expected: FAIL — `Cannot find module '@/src/utils/intencionNativa'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/intencionNativa.ts
import { ENLACE_BASE, hrefInterno } from '@/src/utils/appLink';

const ESQUEMA_APP = 'spendapp:';

/**
 * **Adónde lleva una URL que llega del sistema** (T-095 · SEC M-2).
 *
 * Expo Router abre por su cuenta cualquier `spendapp://<ruta>` cuando hay sesión, así
 * que la lista blanca de `appLink` no alcanzaba: sólo filtraba la página y el camino
 * sin sesión. Esto corre ANTES de navegar, para toda URL externa.
 *
 * - URL de la app (`spendapp:` o ruta `/…`) → su pantalla si es enlazable, si no `/`.
 * - https de la página de links → igual.
 * - Cualquier otra (login de Google, dev client) → intacta: no es nuestra.
 *
 * Nunca lanza: un error acá cierra la app (ver `NativeIntent` en expo-router).
 */
export function destinoDeUrlExterna(path: string): string {
  try {
    if (typeof path !== 'string' || path.length === 0) return '/';
    if (path.startsWith('/')) return hrefInterno(`${ESQUEMA_APP}/${path}`) ?? '/';
    if (path.startsWith(ESQUEMA_APP)) return hrefInterno(path) ?? '/';
    if (path.startsWith(ENLACE_BASE.replace(/\/$/, ''))) return hrefInterno(path) ?? '/';
    return path;
  } catch {
    return '/';
  }
}
```

```tsx
// app/+native-intent.tsx
import { destinoDeUrlExterna } from '@/src/utils/intencionNativa';

/** Toda URL que llega del sistema pasa por la lista blanca (T-095). */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return destinoDeUrlExterna(path);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/utils/__tests__/intencionNativa.test.ts`
Expected: PASS. Si `'/contact/add?…'` falla porque `rutaDeEnlace` no quita la barra de `spendapp:///…`, revisar `src/utils/appLink.ts:77` (`replace(/^\/+/, '')`) — ya la quita; no cambiar `appLink`.

- [ ] **Step 5: Proof of red**

Cambiar temporalmente `return hrefInterno(path) ?? '/'` de la rama `ESQUEMA_APP` por `return path`. Run: `npx jest src/utils/__tests__/intencionNativa.test.ts`. Expected: caen los casos `spendapp://debug/identity`, etc. Restaurar y volver a correr (PASS). Anotar el resultado para el mensaje del commit.

- [ ] **Step 6: Guard de rutas declaradas**

Run: `npx jest src/__tests__/rutasDeclaradas.test.ts`
Expected: PASS. Si falla porque `+native-intent.tsx` no es una pantalla, agregar la excepción en ese test **sólo para archivos que empiezan con `+`** (convención de expo-router), con un comentario que lo explique.

- [ ] **Step 7: Commit**

```bash
git add src/utils/intencionNativa.ts src/utils/__tests__/intencionNativa.test.ts app/+native-intent.tsx src/__tests__/rutasDeclaradas.test.ts
git commit -m "fix(links): la lista blanca rige también con sesión (T-095)

Relevado (Task 1): <resumen de qué URLs recibe redirectSystemPath>.
Proof of red: <resultado>.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
(Reemplazar los dos `<…>` por lo anotado en Task 1 y Step 5 antes de commitear.)

### Task 3: Pantallas de debug fuera de producción

**Files:**
- Create: `src/components/SoloEnDesarrollo.tsx`
- Test: `src/components/__tests__/SoloEnDesarrollo.test.tsx`
- Modify: `app/debug/identity.tsx` (default export), `app/debug/relay.tsx` (default export)

**Interfaces:**
- Produces: `SoloEnDesarrollo({ children, isDev }: { children: React.ReactNode; isDev?: boolean })`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/__tests__/SoloEnDesarrollo.test.tsx
import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { SoloEnDesarrollo } from '@/src/components/SoloEnDesarrollo';

const redirigidoA: string[] = [];
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => { redirigidoA.push(href); return null; },
}));

beforeEach(() => { redirigidoA.length = 0; });

describe('SoloEnDesarrollo', () => {
  it('en producción no dibuja la pantalla y manda al inicio', () => {
    const { queryByText } = render(
      <SoloEnDesarrollo isDev={false}><Text>debug</Text></SoloEnDesarrollo>,
    );
    expect(queryByText('debug')).toBeNull();
    expect(redirigidoA).toEqual(['/']);
  });

  it('en desarrollo la dibuja', () => {
    const { getByText } = render(
      <SoloEnDesarrollo isDev><Text>debug</Text></SoloEnDesarrollo>,
    );
    expect(getByText('debug')).toBeTruthy();
    expect(redirigidoA).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/__tests__/SoloEnDesarrollo.test.tsx`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/SoloEnDesarrollo.tsx
import React from 'react';
import { Redirect } from 'expo-router';

/**
 * Pantallas de diagnóstico sólo en desarrollo (T-095 · SEC M-2).
 *
 * El botón que lleva a ellas ya estaba detrás de `__DEV__`, pero la RUTA seguía viva en
 * producción: `spendapp://debug/identity` abría el «borrar todo» desde cualquier web.
 */
export function SoloEnDesarrollo({ children, isDev = __DEV__ }: { children: React.ReactNode; isDev?: boolean }) {
  if (!isDev) return <Redirect href="/" />;
  return <>{children}</>;
}
```

- [ ] **Step 4: Envolver las dos pantallas**

En `app/debug/identity.tsx`: renombrar `export default function <Nombre>(` a `function PantallaIdentidad(` (sin cambiar el cuerpo) y agregar al final:

```tsx
import { SoloEnDesarrollo } from '@/src/components/SoloEnDesarrollo';

export default function DebugIdentity() {
  return <SoloEnDesarrollo><PantallaIdentidad /></SoloEnDesarrollo>;
}
```
(El `import` va con los demás imports del archivo, arriba.)

En `app/debug/relay.tsx`: lo mismo con `PantallaRelay` y `export default function DebugRelay()`.

- [ ] **Step 5: Run tests**

Run: `npx jest src/components/__tests__/SoloEnDesarrollo.test.tsx src/__tests__/rutasDeclaradas.test.ts`
Expected: PASS.

- [ ] **Step 6: Proof of red**

Cambiar `if (!isDev)` por `if (false)`. Run el test de `SoloEnDesarrollo`: cae «en producción no dibuja…». Restaurar, PASS.

- [ ] **Step 7: Suite, tipos, lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: todo verde; lint 0 errores (los warnings viejos no cuentan).

- [ ] **Step 8: Commit**

```bash
git add src/components/SoloEnDesarrollo.tsx src/components/__tests__/SoloEnDesarrollo.test.tsx app/debug/identity.tsx app/debug/relay.tsx
git commit -m "fix(debug): las pantallas de diagnóstico no existen en producción (T-095)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

## Criterios de la spec → tareas
1 → Task 2 (casos no enlazables) · 2 → Task 2 (enlazables y compactos) · 3 → Task 2 (basura) · 4 → Task 3 · 5 → no se toca `router.push` (sin tarea: `redirectSystemPath` sólo recibe URLs del sistema) · 6 → Task 1 + caso «no toca URLs que no son de la app».
