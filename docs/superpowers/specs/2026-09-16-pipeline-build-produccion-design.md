# Pipeline de build de producción (EAS Workflows) — Diseño

**Fecha:** 2026-09-16
**Disparador:** el PO pidió dejar listo el camino para generar los bundles de producción (iOS/Android) que van a subir a las stores, ahora que T-096 está mergeado y el código está congelado para TestFlight.

## Contexto

El repo no tiene ningún pipeline de CI/CD hoy (no hay `.github/workflows/` ni `.eas/workflows/`). `eas.json` ya existe con perfiles `development`/`preview`/`production` y un guard local (`scripts/verificar-env-build.js`, corrido por EAS como `eas-build-post-install`) que corta el build si faltan las 4 env vars de Supabase/Google. Esas 4 ya están cargadas en EAS para `production` y `preview` — verificado en vivo durante el brainstorm, ya no es un bloqueo.

El proyecto tiene una skill local (`expo-cicd-workflows`, symlink a `.agents/skills/`) que documenta que Expo tiene su propio motor de CI/CD nativo — **EAS Workflows** (`.eas/workflows/*.yml`, corridos por `eas workflow:run` o por triggers automáticos) — en vez de depender de GitHub Actions. Se eligió EAS Workflows sobre GitHub Actions: corre en la infraestructura de EAS con la autenticación local ya existente (`eas login`), sin necesitar gestionar un `EXPO_TOKEN` como secret de GitHub.

## Objetivo

Un pipeline que, disparado a mano cuando el PO decida, corra los checks de calidad del proyecto y — si pasan — compile los bundles de producción de iOS y Android en la nube de EAS, dejándolos listos para un `eas submit` manual posterior.

## Fuera de alcance (explícito)

- **Submit automático a las stores.** El pipeline termina en el build; subir a TestFlight/Play internal sigue siendo un comando manual (`eas submit`) que el PO corre cuando los bloqueos de cuenta Apple/2FA/T-121/Play service account estén resueltos.
- **Triggers automáticos** (push a main, tags, schedule). Solo disparo manual — código congelado, cada build de producción es una decisión deliberada.
- **El flag `ITSAppUsesNonExemptEncryption` de T-121.** No se valida en este pipeline; sigue siendo un pendiente de firma del PO, tracked aparte.
- **La variable huérfana `EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID`** (no está en la lista de `verificar-env-build.js` pese a existir en `.env`/EAS). Se deja anotada como posible gap a investigar en un ticket futuro, no se toca acá.
- Elegir plataforma por invocación: siempre corren las dos (decisión explícita del PO).

## Arquitectura

Tres componentes nuevos:

```
.eas/workflows/build-produccion.yml     ← el workflow en sí (EAS Workflows)
scripts/verificar-requisitos-tienda.js  ← nuevo guard estático, corre dentro del workflow
.claude/skills/deploy-splitp2p/SKILL.md ← skill de proyecto que dispara el workflow por vos
```

Flujo: PO invoca `/deploy-splitp2p` → la skill corre `eas workflow:run .eas/workflows/build-produccion.yml` desde la raíz del repo → EAS ejecuta el job `gate_calidad` (lint + tsc + jest + requisitos de tienda) en su propia VM → si pasa, dispara en paralelo `build_ios` y `build_android` (ambos con `needs: [gate_calidad]`, perfil `production`) en la nube de build de EAS → EAS deja los `.ipa`/`.aab` listos en el dashboard del proyecto, con notificación de éxito/fallo visible ahí. Nada de esto toca GitHub Actions ni requiere secrets nuevos: la autenticación es la sesión local de `eas login` que ya tenés.

## Componente 1 — `.eas/workflows/build-produccion.yml`

```yaml
name: Build de producción

on:
  workflow_dispatch: {}

jobs:
  gate_calidad:
    name: Gate de calidad
    type: custom
    steps:
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm test -- --ci
      - run: node scripts/verificar-requisitos-tienda.js

  build_ios:
    name: Build iOS (production)
    type: build
    needs: [gate_calidad]
    params:
      platform: ios
      profile: production

  build_android:
    name: Build Android (production)
    type: build
    needs: [gate_calidad]
    params:
      platform: android
      profile: production
```

Notas de la sintaxis (validadas contra el schema oficial de EAS Workflows, `https://api.expo.dev/v2/workflows/schema`, y `https://docs.expo.dev/eas/workflows/get-started/`):
- `workflow_dispatch: {}` es válido sin `inputs` — no hace falta ningún input porque siempre corren las dos plataformas.
- El job type `build` exige `platform` como `ios` o `android` puntual — no existe un valor `all`; por eso son dos jobs, no uno.
- `needs: [gate_calidad]` en ambos builds asegura que ninguno arranca si el gate falla.
- El job `gate_calidad` es de tipo `custom` (`steps` con `run:` — comandos de shell tal cual correrían en local).

## Componente 2 — `scripts/verificar-requisitos-tienda.js`

Mismo estilo que `scripts/verificar-env-build.js` (Node puro, sin dependencias, sin red, `module.exports` + bloque `if (require.main === module)`, exit code 0/1). No mira valores de env — mira `app.json` y el filesystem.

**Chequeos (ambos elegidos en el brainstorm):**

1. **Assets referenciados existen en disco.** Para cada ruta de archivo que `app.json` referencia, resuelve relativa a la raíz del repo y falla si no existe, reportando el campo y la ruta:
   - `expo.icon`
   - `expo.android.adaptiveIcon.foregroundImage`, `.backgroundImage`, `.monochromeImage`
   - `expo.web.favicon`
   - La imagen de splash: no es un campo top-level, vive dentro de `expo.plugins` — hay que buscar la entrada del array cuyo primer elemento es el string `"expo-splash-screen"`, tomar su segundo elemento (objeto de config) y leer `.image` (y `.dark.image` si está presente).
2. **Campos obligatorios no vacíos.** `expo.name`, `expo.slug`, `expo.version`, `expo.ios.bundleIdentifier`, `expo.android.package` deben existir y no ser string vacío.
3. **Coherencia permisos ↔ descripciones de uso (iOS).** Mapeo fijo entre permisos Android que tienen equivalente de "usage description" en iOS y la clave de `ios.infoPlist` correspondiente:
   - `android.permission.CAMERA` ↔ `NSCameraUsageDescription`
   - `android.permission.READ_MEDIA_IMAGES` ↔ `NSPhotoLibraryUsageDescription`
   Regla: si `android.permissions` incluye el permiso, la clave de `infoPlist` correspondiente debe existir y no estar vacía. Si la clave de `infoPlist` existe pero el permiso Android equivalente NO está en la lista, también falla (descripción huérfana — señal de un permiso que se sacó de un lado y no del otro). Los permisos/claves fuera de este mapeo (ej. `NSPhotoLibraryUsageDescription` sin equivalente 1:1 evidente) no se chequean — el mapeo cubre solo los pares que hoy existen en `app.json`, no pretende ser exhaustivo de todo iOS/Android.

Salida: igual que `verificar-env-build.js` — un mensaje por `console.error` listando TODOS los problemas encontrados (no corta en el primero), exit 1 si hay alguno, exit 0 si no.

**Agregar a `package.json`:**
```json
"verificar-tienda": "node scripts/verificar-requisitos-tienda.js"
```
para poder correrlo en local antes de gastar un run de EAS.

**Test:** `scripts/__tests__/verificar-requisitos-tienda.test.js` — cubre: happy path (app.json actual del repo pasa), un asset faltante, un campo obligatorio vacío, un permiso sin descripción, una descripción huérfana. Sigue el patrón de test de módulos de lógica pura del proyecto (sin red, sin filesystem real — recibe el objeto `app.json` parseado y una función `existeArchivo` inyectable para simular presencia/ausencia de assets sin tocar disco).

## Componente 3 — skill de proyecto `deploy-splitp2p`

`.claude/skills/deploy-splitp2p/SKILL.md`, con frontmatter:

```yaml
---
name: deploy-splitp2p
description: Dispara el pipeline de build de producción de spendApp (EAS Workflows) cuando el PO decide generar bundles nuevos para las stores.
---
```

Cuerpo: instruye a correr, desde la raíz del repo (`/Users/gabrielsk/Documents/Proyects/spendApp`):

```bash
eas workflow:run .eas/workflows/build-produccion.yml
```

y reportar al PO el output tal cual lo imprime `eas-cli` (incluye el link al run en el dashboard de EAS para seguir el progreso de `gate_calidad`/`build_ios`/`build_android` en vivo). No hace falta ningún flag de proyecto — `eas-cli` lo resuelve del `eas.json`/`app.json` local. Si `eas workflow:run` devuelve error de autenticación, indicarle al PO que corra `eas login` una vez.

## Testing del pipeline en sí

No hay forma de "testear" un workflow de EAS sin gastar una corrida real. El plan de implementación va a incluir un paso de validación local con el propio validador que trae `expo-cicd-workflows` (`node .agents/skills/expo-cicd-workflows/scripts/validate.js .eas/workflows/build-produccion.yml`) antes de dar la tarea por terminada — valida la sintaxis contra el schema oficial sin necesidad de correr nada en EAS. (Nota: el `fetch.js` de esa skill usa `import.meta.main`, que no existe en Node 20 — el proyecto corre Node 20 — así que su modo CLI no imprime nada; no es algo a arreglar acá, se puede seguir usando `WebFetch`/`curl` directo para consultar el schema/docs si hace falta durante la implementación.)

## Global Constraints

- No se agregan triggers automáticos (`push`, `schedule`, etc.) — solo `workflow_dispatch`.
- No se toca `eas.json` en este trabajo (el submit de iOS queda para cuando se resuelvan los bloqueos del PO, es un ticket aparte).
- El gate de calidad debe correr, en este orden, `npm ci` → `lint` → `tsc --noEmit` → `jest` → `verificar-requisitos-tienda.js`, y cualquier fallo debe cortar antes de llegar a `eas build` (vía `needs`).
- `verificar-requisitos-tienda.js` sigue el mismo estilo y convenciones que `verificar-env-build.js` (Node puro, sin dependencias nuevas, exit code, reporta todos los problemas de una).
- Lint baseline (124/0), tsc limpio y suite de jest en verde se mantienen — el script nuevo y su test no pueden introducir warnings nuevos.
