# T-094 · El link pendiente no se reabre en otra cuenta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un link sólo quede pendiente si **llegó** sin sesión, que se abra una vez tras el login, y que cerrar sesión lo descarte.

**Architecture:** Se reemplaza `Linking.useURL()` (que retiene la última URL y re-dispara el efecto al cambiar la sesión) por un hook `useEnlacesEntrantes` que escucha `getInitialURL()` una vez y `addEventListener('url')`. Cada URL se clasifica **al llegar** con `procesarUrlEntrante(url, haySesion)`; si la sesión todavía se está hidratando, espera a que termine. `signOut` descarta el pendiente.

**Tech Stack:** Expo SDK 54, `expo-linking`, Zustand (`useAuthStore`), Jest + `@testing-library/react-native` (`renderHook`).

**Spec:** `docs/superpowers/specs/2026-09-12-fase1-endurecimiento-links-design.md` (sección T-094).

## Global Constraints
- Agente: `nerv-mobile`. QA: `nerv-qa` Standard. **Proof of red** documentado por criterio.
- Sin dependencias nativas nuevas. Alias `@/`. Suite verde, `npx tsc --noEmit` 0, `npm run lint` 0 errores.
- Nunca leer valores de variables de entorno ni correr `eas env:list`.
- Rama: `fix/T-094-link-pendiente` **desde `main` con T-095 ya mergeado**. Commits con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. No mergear ni pushear.
- No romper T-093: los links con sesión siguen llegando a `app/contact/add.tsx` y pasan por su confirmación.

## File Structure
- Modify `src/utils/enlacePendiente.ts` — suma `marcarConsumido`, `descartarEnlacePendiente`, `procesarUrlEntrante`.
- Modify `src/utils/__tests__/enlacePendiente.test.ts`.
- Create `src/hooks/useEnlacesEntrantes.ts` — escucha de URLs.
- Create `src/hooks/__tests__/useEnlacesEntrantes.test.ts`.
- Modify `src/store/authStore.ts:272-283` (`signOut`).
- Modify `app/_layout.tsx:7,21,90-103` — usa el hook, saca `useURL`.

---

### Task 1: Funciones puras del pendiente

**Files:**
- Modify: `src/utils/enlacePendiente.ts`
- Test: `src/utils/__tests__/enlacePendiente.test.ts`

**Interfaces:**
- Consumes: `recordarEnlace(url)`, `tomarEnlacePendiente()` (existen).
- Produces:
  - `marcarConsumido(url: string): void`
  - `descartarEnlacePendiente(): void`
  - `procesarUrlEntrante(url: string | null, haySesion: boolean): void`

- [ ] **Step 1: Write the failing tests** (agregar al final del `describe` existente)

```ts
// import: sumar marcarConsumido, descartarEnlacePendiente, procesarUrlEntrante al import existente

  it('un link que llega CON sesión no queda pendiente, ni después de cerrar sesión', () => {
    const url = 'spendapp://contact/add?id=u1&name=Ada';
    procesarUrlEntrante(url, true);
    expect(tomarEnlacePendiente()).toBeNull();
    // Aunque algo lo vuelva a presentar sin sesión, ya se usó.
    procesarUrlEntrante(url, false);
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('un link que llega SIN sesión queda pendiente una sola vez', () => {
    procesarUrlEntrante('spendapp://groups/join?g=g1&t=abc&e=1', false);
    expect(tomarEnlacePendiente()).toBe('/groups/join?g=g1&t=abc&e=1');
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('descartar borra el pendiente (cerrar sesión)', () => {
    recordarEnlace('spendapp://contact/add?id=u1&name=Ada');
    descartarEnlacePendiente();
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('marcarConsumido impide que ese link quede pendiente', () => {
    const url = 'spendapp://contact/add?id=u2&name=Bea';
    marcarConsumido(url);
    recordarEnlace(url);
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('null no hace nada', () => {
    procesarUrlEntrante(null, false);
    expect(tomarEnlacePendiente()).toBeNull();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/utils/__tests__/enlacePendiente.test.ts`
Expected: FAIL — `procesarUrlEntrante is not a function` (o error de import en TS).

- [ ] **Step 3: Implementation** (agregar a `src/utils/enlacePendiente.ts`, antes de `_reiniciarEnlacePendiente`)

```ts
/** Un link que ya se abrió con sesión: no debe volver a quedar pendiente (T-094). */
export function marcarConsumido(url: string): void {
  consumidos.add(url);
  if (pendiente === url) pendiente = null;
}

/** Cerrar sesión descarta lo pendiente: el próximo login puede ser de otra cuenta (T-094). */
export function descartarEnlacePendiente(): void {
  pendiente = null;
}

/**
 * **Clasifica una URL en el momento en que LLEGA** (T-094 · SEC M-1).
 *
 * Antes se guardaba desde un efecto que dependía de la sesión, con la URL que retenía
 * `Linking.useURL()`: al cerrar sesión el efecto corría de nuevo y re-guardaba un link
 * ya usado, y el próximo login —de cualquier cuenta— lo abría.
 */
export function procesarUrlEntrante(url: string | null, haySesion: boolean): void {
  if (!url) return;
  if (haySesion) marcarConsumido(url);
  else recordarEnlace(url);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/utils/__tests__/enlacePendiente.test.ts`
Expected: PASS (los 4 tests viejos y los 5 nuevos).

- [ ] **Step 5: Proof of red**

En `procesarUrlEntrante`, cambiar `if (haySesion) marcarConsumido(url);` por `if (haySesion) return;`. Run: cae «un link que llega CON sesión no queda pendiente…». Restaurar, PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/enlacePendiente.ts src/utils/__tests__/enlacePendiente.test.ts
git commit -m "fix(links): el pendiente se decide cuando el link llega (T-094)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 2: `signOut` descarta el pendiente

**Files:**
- Modify: `src/store/authStore.ts` (`signOut`, línea ~272)
- Test: `src/utils/__tests__/enlacePendienteSesion.test.ts` (nuevo)

**Interfaces:**
- Consumes: `descartarEnlacePendiente()` (Task 1).

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/__tests__/enlacePendienteSesion.test.ts
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/directoryAuth', () => ({ signOutOfDirectory: jest.fn(async () => {}) }));

import { useAuthStore } from '@/src/store/authStore';
import { recordarEnlace, tomarEnlacePendiente, _reiniciarEnlacePendiente } from '@/src/utils/enlacePendiente';

beforeEach(() => _reiniciarEnlacePendiente());

describe('cerrar sesión y el link pendiente (T-094)', () => {
  it('signOut descarta el link pendiente', () => {
    recordarEnlace('spendapp://contact/add?id=u1&name=Ada');
    useAuthStore.getState().signOut();
    expect(tomarEnlacePendiente()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/utils/__tests__/enlacePendienteSesion.test.ts`
Expected: FAIL — `expected null, received "/contact/add?id=u1&name=Ada"`. Si falla por otro motivo (un módulo nativo sin mock), copiar el mock que falte desde `src/screens/__tests__/campanaEnTodasLasTabs.test.tsx:12-20` y volver a correr hasta que falle por el motivo esperado.

- [ ] **Step 3: Implementation**

En `src/store/authStore.ts`, sumar al bloque de imports:
```ts
import { descartarEnlacePendiente } from '@/src/utils/enlacePendiente';
```
y en `signOut`, justo después de `olvidarPruebasDeProveedor();`:
```ts
    // Un link que quedó esperando el login no es de la cuenta que entre después (T-094).
    descartarEnlacePendiente();
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/utils/__tests__/enlacePendienteSesion.test.ts`
Expected: PASS. Luego `npx tsc --noEmit` (verificar que el import no arma un ciclo que rompa tipos).

- [ ] **Step 5: Proof of red** — comentar la llamada, cae el test, restaurar.

- [ ] **Step 6: Commit**

```bash
git add src/store/authStore.ts src/utils/__tests__/enlacePendienteSesion.test.ts
git commit -m "fix(sesion): cerrar sesión descarta el link pendiente (T-094)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 3: Hook `useEnlacesEntrantes` y cambio del layout

**Files:**
- Create: `src/hooks/useEnlacesEntrantes.ts`
- Test: `src/hooks/__tests__/useEnlacesEntrantes.test.ts`
- Modify: `app/_layout.tsx` (quitar `import * as Linking`, el efecto de líneas 90-103 y su comentario; usar el hook)

**Interfaces:**
- Consumes: `procesarUrlEntrante(url, haySesion)` (Task 1); `useAuthStore` con `currentUser` e `isLoading`.
- Produces: `useEnlacesEntrantes(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/__tests__/useEnlacesEntrantes.test.ts
import { act, renderHook } from '@testing-library/react-native';

let urlInicial: string | null = null;
let emitir: ((e: { url: string }) => void) | null = null;
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(async () => urlInicial),
  addEventListener: jest.fn((_: string, cb: (e: { url: string }) => void) => {
    emitir = cb;
    return { remove: jest.fn() };
  }),
}));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/directoryAuth', () => ({ signOutOfDirectory: jest.fn(async () => {}) }));

import { useEnlacesEntrantes } from '@/src/hooks/useEnlacesEntrantes';
import { useAuthStore } from '@/src/store/authStore';
import { tomarEnlacePendiente, _reiniciarEnlacePendiente } from '@/src/utils/enlacePendiente';
import type { User } from '@/src/types/models';

const ana = { id: 'ua', name: 'Ana', email: '', authProvider: 'google', createdAt: 0, updatedAt: 0, isDeleted: false } as User;
const bob = { ...ana, id: 'ub', name: 'Bob' } as User;
const LINK = 'spendapp://contact/add?id=u9&name=Zoe';

beforeEach(() => {
  _reiniciarEnlacePendiente();
  urlInicial = null;
  emitir = null;
  useAuthStore.setState({ currentUser: null, isLoading: false });
});

async function montar() {
  const r = renderHook(() => useEnlacesEntrantes());
  await act(async () => {}); // resuelve getInitialURL
  return r;
}

describe('useEnlacesEntrantes (T-094 · SEC M-1)', () => {
  it('link con sesión → logout → login de OTRA cuenta: no se abre nada', async () => {
    useAuthStore.setState({ currentUser: ana });
    await montar();
    act(() => emitir!({ url: LINK }));
    act(() => useAuthStore.setState({ currentUser: null }));
    act(() => useAuthStore.setState({ currentUser: bob }));
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('link sin sesión → login: se abre una vez', async () => {
    await montar();
    act(() => emitir!({ url: LINK }));
    act(() => useAuthStore.setState({ currentUser: ana }));
    expect(tomarEnlacePendiente()).toBe('/contact/add?id=u9&name=Zoe');
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('arranque en frío CON sesión guardada: espera la hidratación y no deja pendiente', async () => {
    urlInicial = LINK;
    useAuthStore.setState({ currentUser: null, isLoading: true });
    await montar();
    act(() => useAuthStore.setState({ currentUser: ana, isLoading: false }));
    expect(tomarEnlacePendiente()).toBeNull();
  });

  it('arranque en frío SIN sesión: queda pendiente', async () => {
    urlInicial = LINK;
    useAuthStore.setState({ currentUser: null, isLoading: true });
    await montar();
    act(() => useAuthStore.setState({ isLoading: false }));
    expect(tomarEnlacePendiente()).toBe('/contact/add?id=u9&name=Zoe');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/hooks/__tests__/useEnlacesEntrantes.test.ts`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Implementation**

```ts
// src/hooks/useEnlacesEntrantes.ts
import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useAuthStore } from '@/src/store/authStore';
import { procesarUrlEntrante } from '@/src/utils/enlacePendiente';

/**
 * **Escucha los links que llegan y decide, al llegar, si quedan pendientes** (T-094).
 *
 * Reemplaza a `Linking.useURL()`, que retiene la última URL: un efecto que dependía de
 * la sesión la re-guardaba en cada logout, y el login siguiente —de cualquier cuenta—
 * la abría. Con sesión el link lo abre expo-router (pasando por `+native-intent`); acá
 * sólo se marca como usado.
 *
 * Mientras la sesión se hidrata no se sabe si hay usuario: se espera a que termine.
 */
export function useEnlacesEntrantes(): void {
  useEffect(() => {
    let vivo = true;
    const esperas: (() => void)[] = [];

    const procesar = (url: string | null) => {
      if (!vivo || !url) return;
      const estado = useAuthStore.getState();
      if (!estado.isLoading) {
        procesarUrlEntrante(url, estado.currentUser !== null);
        return;
      }
      const dejar = useAuthStore.subscribe(s => {
        if (s.isLoading) return;
        dejar();
        if (vivo) procesarUrlEntrante(url, s.currentUser !== null);
      });
      esperas.push(dejar);
    };

    void Linking.getInitialURL().then(procesar).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => procesar(url));

    return () => {
      vivo = false;
      sub.remove();
      esperas.forEach(d => d());
    };
  }, []);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/hooks/__tests__/useEnlacesEntrantes.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Cambiar `app/_layout.tsx`**

- Borrar `import * as Linking from 'expo-linking';` (línea 7).
- Cambiar la línea 21 a: `import { tomarEnlacePendiente } from '@/src/utils/enlacePendiente';`
- Sumar: `import { useEnlacesEntrantes } from '@/src/hooks/useEnlacesEntrantes';`
- Reemplazar el bloque de líneas 90-103 (comentario + `urlEntrante` + efecto) por:

```tsx
  /**
   * **Links sin sesión.** Con sesión, expo-router abre la pantalla del link (filtrada por
   * `app/+native-intent.tsx`) y la pantalla lo procesa. Sin sesión, el guard redirige al
   * login: el link queda pendiente y se abre al entrar (rama de arriba). Qué queda
   * pendiente se decide cuando el link LLEGA, no cuando cambia la sesión (T-094).
   */
  useEnlacesEntrantes();
```

- [ ] **Step 6: Proof of red de la regresión original**

En el hook, reemplazar temporalmente el cuerpo de `procesar` por `if (url) procesarUrlEntrante(url, false);` (simula el comportamiento viejo de guardar sin mirar la sesión). Run el test del hook: caen «link con sesión → logout → login de OTRA cuenta» y «arranque en frío CON sesión». Restaurar, PASS.

- [ ] **Step 7: Suite, tipos, lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: verde. Prestar atención a `src/screens/__tests__/contactAddCierra.test.tsx` (T-093): debe seguir verde sin cambios.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useEnlacesEntrantes.ts src/hooks/__tests__/useEnlacesEntrantes.test.ts app/_layout.tsx
git commit -m "fix(links): un link ya usado no se reabre en la cuenta siguiente (T-094)

Proof of red: <resultado del Step 6>.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

## Criterios de la spec → tareas
1 → Task 3 test 1 (+ Task 1) · 2 → Task 3 tests 2 y 4 · 3 → Task 2 · 4 → Task 3 Step 7 (T-093 sin regresión).
**No verificable en Jest:** comportamiento real de `getInitialURL` en arranque en frío → anexo `engram/qa/AUDIT-device-2026-09-12.md` A.3/A.4 (Fase 2).
