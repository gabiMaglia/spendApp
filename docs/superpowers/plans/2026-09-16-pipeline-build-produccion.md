# Pipeline de build de producción (EAS Workflows) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar un pipeline disparable a mano (EAS Workflows) que corra el gate de calidad del proyecto y, si pasa, compile los bundles de producción de iOS y Android — sin submit automático — más una skill de proyecto para dispararlo sin tocar la UI de EAS.

**Architecture:** Tres archivos nuevos, sin dependencias entre sí salvo que el workflow (Task 2) invoca el script de Task 1 como uno de sus pasos. `.eas/workflows/build-produccion.yml` define un job `custom` de gate de calidad del que dependen (`needs`) dos jobs `build` (uno por plataforma). `scripts/verificar-requisitos-tienda.js` es un guard estático de Node puro, mismo estilo que el guard existente `scripts/verificar-env-build.js`. `.claude/skills/deploy-splitp2p/SKILL.md` es la skill de proyecto que corre `eas workflow:run`.

**Tech Stack:** EAS Workflows (YAML, `.eas/workflows/`), Node 20 (CommonJS) para el script de guard, Jest para sus tests, Claude Code skill (Markdown + frontmatter).

**Spec:** docs/superpowers/specs/2026-09-16-pipeline-build-produccion-design.md

## Global Constraints

- Solo trigger `workflow_dispatch`, sin inputs — nunca `push`/`schedule`/otros triggers automáticos.
- No se toca `eas.json` en este trabajo.
- Orden del gate de calidad, todos como pasos separados que cortan la ejecución si fallan: `npm ci` → `npm run lint` → `npx tsc --noEmit` → `npm test -- --ci` → `node scripts/verificar-requisitos-tienda.js`. Los jobs `build_ios`/`build_android` llevan `needs: [gate_calidad]` — no arrancan si el gate falla.
- `scripts/verificar-requisitos-tienda.js`: Node puro (CommonJS, sin dependencias nuevas en `package.json`), mismo estilo que `scripts/verificar-env-build.js` — funciones puras exportadas + un `main()` que hace I/O, exit code 0/1, reporta TODOS los problemas encontrados de una (no corta en el primero).
- Lint baseline (124 warnings, 0 errores), `tsc --noEmit` limpio y la suite de Jest completa en verde se mantienen tal cual — nada de este trabajo puede sumar warnings ni romper un test existente.
- **Nunca ejecutar `eas workflow:run` de verdad durante la implementación o las pruebas** — dispara un build real de producción (gasta crédito de EAS, es una operación externa deliberada reservada al PO). La validación del workflow es estructural/manual, no una corrida real.

---

## Contexto de partida (para quien no vio el spec completo)

- `app.json` ya existe y hoy pasa todos los chequeos que vas a implementar (fue verificado a mano contra el repo real antes de escribir este plan) — si tu test contra el `app.json` real falla, el bug está en tu implementación, no en `app.json`.
- `scripts/verificar-env-build.js` es el guard hermano que ya existe — léelo antes de escribir el tuyo, es la referencia de estilo obligatoria (Node puro, sin dependencias, `module.exports` + `if (require.main === module)`).
- El proyecto usa **español** para nombres de función/variable en este tipo de scripts de infraestructura (mirá `verificar-env-build.js`: `faltantes`, `REQUERIDAS`, `main`) — seguí esa convención, no la inviertas a inglés.

---

### Task 1: Guard de requisitos de tienda (`scripts/verificar-requisitos-tienda.js`)

**Files:**
- Create: `scripts/verificar-requisitos-tienda.js`
- Create: `scripts/__tests__/verificar-requisitos-tienda.test.js`
- Modify: `package.json` (agregar un script `verificar-tienda`)

**Interfaces:**
- Consumes: nada de otras tasks.
- Produces (para Task 2, que lo invoca como paso del workflow): el archivo es ejecutable como `node scripts/verificar-requisitos-tienda.js`, exit code `0` si no hay problemas, `1` si hay al menos uno (mismo contrato que `verificar-env-build.js`). También exporta, vía `module.exports`, las funciones `verificar(appJson, raiz, existeArchivo)`, `verificarCampos(expo)`, `verificarAssets(expo, raiz, existeArchivo)`, `verificarPermisos(expo)` y `main(raiz, log)` — nadie más las consume en este plan, pero son la superficie pública del módulo.

- [ ] **Step 1: Escribir los tests (van a fallar — el módulo no existe todavía)**

Crear `scripts/__tests__/verificar-requisitos-tienda.test.js`:

```javascript
const path = require('path');
const {
  verificar,
  verificarCampos,
  verificarAssets,
  verificarPermisos,
} = require('../verificar-requisitos-tienda');

const RAIZ_REPO = path.join(__dirname, '..', '..');

function appJsonBase() {
  return {
    expo: {
      name: 'spendApp',
      slug: 'spendApp',
      version: '1.0.0',
      icon: './assets/images/icon.png',
      ios: {
        bundleIdentifier: 'com.splitp2p.app',
        infoPlist: {
          NSPhotoLibraryUsageDescription: 'Usamos tu galería de fotos.',
        },
      },
      android: {
        package: 'com.splitp2p.app',
        permissions: [
          'android.permission.CAMERA',
          'android.permission.READ_MEDIA_IMAGES',
        ],
        adaptiveIcon: {
          foregroundImage: './assets/images/android-icon-foreground.png',
          backgroundImage: './assets/images/android-icon-background.png',
          monochromeImage: './assets/images/android-icon-monochrome.png',
        },
      },
      web: { favicon: './assets/images/favicon.png' },
      plugins: [
        'expo-router',
        ['expo-splash-screen', { image: './assets/images/splash-nativo.png' }],
        ['expo-camera', { cameraPermission: 'Usamos la cámara para el ticket.' }],
        ['expo-image-picker', { photosPermission: 'Usamos tu galería.' }],
      ],
    },
  };
}

const existeSiempre = () => true;

describe('verificar (requisitos de tienda)', () => {
  it('no reporta problemas con un app.json completo y assets presentes', () => {
    const problemas = verificar(appJsonBase(), RAIZ_REPO, existeSiempre);
    expect(problemas).toEqual([]);
  });

  it('pasa contra el app.json real del repo (assets deben existir de verdad en disco)', () => {
    const appJsonReal = require(path.join(RAIZ_REPO, 'app.json'));
    const problemas = verificar(appJsonReal, RAIZ_REPO);
    expect(problemas).toEqual([]);
  });

  it('reporta un asset faltante', () => {
    const appJson = appJsonBase();
    // verificarAssets llama a existeArchivo con la ruta YA UNIDA a la raíz (path.join),
    // no con el valor crudo del campo — el predicado tiene que matchear sobre eso.
    const existeExcepto = (rutaAbsoluta) => !rutaAbsoluta.endsWith('/assets/images/icon.png');
    const problemas = verificarAssets(appJson.expo, RAIZ_REPO, existeExcepto);
    expect(problemas).toEqual([
      'Asset referenciado no existe en disco: expo.icon → ./assets/images/icon.png',
    ]);
  });

  it('reporta un campo obligatorio vacío', () => {
    const appJson = appJsonBase();
    appJson.expo.slug = '';
    const problemas = verificarCampos(appJson.expo);
    expect(problemas.some((p) => p.includes('expo.slug'))).toBe(true);
  });

  it('reporta un permiso Android sin su descripción de uso en iOS', () => {
    const appJson = appJsonBase();
    delete appJson.expo.ios.infoPlist.NSPhotoLibraryUsageDescription;
    appJson.expo.plugins = appJson.expo.plugins.filter(
      (p) => !(Array.isArray(p) && p[0] === 'expo-image-picker')
    );
    const problemas = verificarPermisos(appJson.expo);
    expect(problemas.some((p) => p.includes('READ_MEDIA_IMAGES'))).toBe(true);
  });

  it('reporta una descripción de uso huérfana sin el permiso Android declarado', () => {
    const appJson = appJsonBase();
    appJson.expo.android.permissions = ['android.permission.READ_MEDIA_IMAGES'];
    const problemas = verificarPermisos(appJson.expo);
    expect(problemas.some((p) => p.includes('CAMERA'))).toBe(true);
  });
});
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

Run: `npx jest scripts/__tests__/verificar-requisitos-tienda.test.js`
Expected: FAIL — `Cannot find module '../verificar-requisitos-tienda'`

- [ ] **Step 3: Implementar el módulo**

Crear `scripts/verificar-requisitos-tienda.js`:

```javascript
/**
 * Guard de requisitos mínimos de tienda: un build de producción no debería salir con
 * un ícono/splash roto, un campo obligatorio vacío o un permiso sin su descripción de uso.
 *
 * Mira solo app.json + filesystem. Sin red, sin dependencias nuevas.
 * Corre como paso del gate de calidad en .eas/workflows/build-produccion.yml.
 */
const fs = require('fs');
const path = require('path');

const CAMPOS_OBLIGATORIOS = [
  ['expo.name', (expo) => expo.name],
  ['expo.slug', (expo) => expo.slug],
  ['expo.version', (expo) => expo.version],
  ['expo.ios.bundleIdentifier', (expo) => expo.ios && expo.ios.bundleIdentifier],
  ['expo.android.package', (expo) => expo.android && expo.android.package],
];

const CAMPOS_DE_ASSET = [
  ['expo.icon', (expo) => expo.icon],
  [
    'expo.android.adaptiveIcon.foregroundImage',
    (expo) => expo.android && expo.android.adaptiveIcon && expo.android.adaptiveIcon.foregroundImage,
  ],
  [
    'expo.android.adaptiveIcon.backgroundImage',
    (expo) => expo.android && expo.android.adaptiveIcon && expo.android.adaptiveIcon.backgroundImage,
  ],
  [
    'expo.android.adaptiveIcon.monochromeImage',
    (expo) => expo.android && expo.android.adaptiveIcon && expo.android.adaptiveIcon.monochromeImage,
  ],
  ['expo.web.favicon', (expo) => expo.web && expo.web.favicon],
];

const PARES_PERMISO_DESCRIPCION = [
  {
    permiso: 'android.permission.CAMERA',
    nombre: 'CAMERA',
    obtenerDescripcion: (expo) =>
      (expo.ios && expo.ios.infoPlist && expo.ios.infoPlist.NSCameraUsageDescription) ||
      (configDePlugin(expo.plugins, 'expo-camera') || {}).cameraPermission,
  },
  {
    permiso: 'android.permission.READ_MEDIA_IMAGES',
    nombre: 'READ_MEDIA_IMAGES',
    obtenerDescripcion: (expo) =>
      (expo.ios && expo.ios.infoPlist && expo.ios.infoPlist.NSPhotoLibraryUsageDescription) ||
      (configDePlugin(expo.plugins, 'expo-image-picker') || {}).photosPermission,
  },
];

function configDePlugin(plugins, nombre) {
  if (!Array.isArray(plugins)) return undefined;
  const entrada = plugins.find((p) => Array.isArray(p) && p[0] === nombre);
  return entrada ? entrada[1] : undefined;
}

function rutasDeSplash(expo) {
  const config = configDePlugin(expo.plugins, 'expo-splash-screen');
  if (!config) return [];
  const rutas = [];
  if (config.image) rutas.push(['expo.plugins[expo-splash-screen].image', config.image]);
  if (config.dark && config.dark.image) {
    rutas.push(['expo.plugins[expo-splash-screen].dark.image', config.dark.image]);
  }
  return rutas;
}

function esVacio(valor) {
  return typeof valor !== 'string' || valor.trim() === '';
}

function verificarCampos(expo) {
  return CAMPOS_OBLIGATORIOS.filter(([, obtener]) => esVacio(obtener(expo))).map(
    ([nombre]) => `Campo obligatorio vacío o ausente: ${nombre}`
  );
}

function verificarAssets(expo, raiz, existeArchivo = fs.existsSync) {
  const rutas = [
    ...CAMPOS_DE_ASSET.map(([nombre, obtener]) => [nombre, obtener(expo)]),
    ...rutasDeSplash(expo),
  ];
  return rutas
    .filter(([, ruta]) => !esVacio(ruta))
    .filter(([, ruta]) => !existeArchivo(path.join(raiz, ruta)))
    .map(([nombre, ruta]) => `Asset referenciado no existe en disco: ${nombre} → ${ruta}`);
}

function verificarPermisos(expo) {
  const permisos = (expo.android && expo.android.permissions) || [];
  const problemas = [];
  for (const par of PARES_PERMISO_DESCRIPCION) {
    const declarado = permisos.includes(par.permiso);
    const tieneDescripcion = !esVacio(par.obtenerDescripcion(expo));
    if (declarado && !tieneDescripcion) {
      problemas.push(`Permiso ${par.nombre} declarado en Android sin descripción de uso en iOS`);
    }
    if (!declarado && tieneDescripcion) {
      problemas.push(`Descripción de uso de ${par.nombre} presente en iOS sin el permiso Android declarado`);
    }
  }
  return problemas;
}

function verificar(appJson, raiz, existeArchivo = fs.existsSync) {
  const expo = appJson.expo || {};
  return [
    ...verificarCampos(expo),
    ...verificarAssets(expo, raiz, existeArchivo),
    ...verificarPermisos(expo),
  ];
}

function main(raiz = path.join(__dirname, '..'), log = console.error) {
  const appJson = JSON.parse(fs.readFileSync(path.join(raiz, 'app.json'), 'utf8'));
  const problemas = verificar(appJson, raiz);
  if (problemas.length === 0) return 0;
  log(`Requisitos de tienda incompletos:\n- ${problemas.join('\n- ')}`);
  return 1;
}

module.exports = { verificar, verificarCampos, verificarAssets, verificarPermisos, main };

if (require.main === module) process.exitCode = main();
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

Run: `npx jest scripts/__tests__/verificar-requisitos-tienda.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Correr el script directo contra el repo real**

Run: `node scripts/verificar-requisitos-tienda.js; echo "exit: $?"`
Expected: sin output, `exit: 0`

- [ ] **Step 6: Agregar el script a `package.json`**

En la sección `"scripts"` de `package.json` (junto a `"lint"` y `"test"`), agregar:

```json
"verificar-tienda": "node scripts/verificar-requisitos-tienda.js",
```

- [ ] **Step 7: Lint + suite completa, confirmar que no rompiste nada**

Run: `npm run lint && npm test`
Expected: lint en el mismo baseline (124 warnings, 0 errores — ni uno más), suite completa en verde incluyendo los 6 tests nuevos.

- [ ] **Step 8: Commit**

```bash
git add scripts/verificar-requisitos-tienda.js scripts/__tests__/verificar-requisitos-tienda.test.js package.json
git commit -m "feat(scripts): guard de requisitos mínimos de tienda para el build de producción"
```

---

### Task 2: Workflow de EAS (`build-produccion.yml`)

**Files:**
- Create: `.eas/workflows/build-produccion.yml`

**Interfaces:**
- Consumes: `scripts/verificar-requisitos-tienda.js` de Task 1 (invocado como paso del job `gate_calidad`; ya tiene que existir en el repo cuando se corra este workflow de verdad).
- Produces (para Task 3): la ruta `.eas/workflows/build-produccion.yml`, que la skill de Task 3 pasa como argumento a `eas workflow:run`.

- [ ] **Step 1: Crear el archivo del workflow**

Crear `.eas/workflows/build-produccion.yml`:

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

- [ ] **Step 2: Validar el YAML es sintácticamente válido**

`js-yaml` ya está instalado como dependencia transitiva del repo — se puede usar directo sin instalar nada nuevo.

Run:
```bash
node -e "const yaml = require('js-yaml'); const fs = require('fs'); const doc = yaml.load(fs.readFileSync('.eas/workflows/build-produccion.yml', 'utf8')); console.log(JSON.stringify(doc, null, 2));"
```
Expected: imprime el documento parseado sin tirar excepción, con las claves `name`, `on`, `jobs` (y dentro de `jobs`, las tres claves `gate_calidad`/`build_ios`/`build_android`) visibles en el JSON impreso.

**Nota — por qué no un validador automático contra el schema:** este proyecto usa Node 20, y tanto `fetch.js` como `validate.js` de la skill `expo-cicd-workflows` (`.agents/skills/expo-cicd-workflows/scripts/`) dependen de `import.meta.main`, una API que no existe en Node 20 — su modo CLI no imprime nada ni falla, simplemente no hace nada. No es algo a arreglar en este plan (es código de una skill de terceros, fuera de alcance). En su lugar, el checklist del Step 3 verifica a mano los mismos puntos que un validador de schema chequearía, ya confirmados contra el schema oficial (`https://api.expo.dev/v2/workflows/schema`) durante el diseño.

- [ ] **Step 3: Checklist de revisión estructural manual (reemplaza al validador automático roto)**

Confirmar, leyendo el archivo, cada uno de estos puntos (todos ya verificados contra el schema oficial de EAS Workflows durante el diseño — este paso es releer el archivo creado y tildarlos, no investigarlos de nuevo):

- [ ] Las únicas claves de primer nivel son `name`, `on`, `jobs` (el schema no permite otras).
- [ ] `on.workflow_dispatch` es un objeto vacío (`{}`) — válido sin `inputs`, porque este pipeline siempre corre las dos plataformas.
- [ ] `jobs.gate_calidad.type` es `custom` y tiene un array `steps` no vacío, cada paso con `run:`.
- [ ] `jobs.build_ios.type` y `jobs.build_android.type` son `build`, con `params.platform` en `ios`/`android` respectivamente (nunca `all` — el schema exige un valor puntual) y `params.profile: production`.
- [ ] `jobs.build_ios.needs` y `jobs.build_android.needs` incluyen `gate_calidad`.

- [ ] **Step 4: Commit**

```bash
git add .eas/workflows/build-produccion.yml
git commit -m "feat(ci): workflow de EAS para el build de producción (gate de calidad + build iOS/Android)"
```

---

### Task 3: Skill de proyecto `deploy-splitp2p`

**Files:**
- Create: `.claude/skills/deploy-splitp2p/SKILL.md`

**Interfaces:**
- Consumes: la ruta `.eas/workflows/build-produccion.yml` producida en Task 2 (referenciada literal en el comando que la skill instruye correr).
- Produces: nada que otra task consuma — es la entrega final visible al usuario (invocable como `/deploy-splitp2p`).

- [ ] **Step 1: Crear el archivo de la skill**

Crear `.claude/skills/deploy-splitp2p/SKILL.md`:

```markdown
---
name: deploy-splitp2p
description: Dispara el pipeline de build de producción de spendApp (EAS Workflows) cuando el PO decide generar bundles nuevos para las stores.
---

# Deploy de producción — spendApp

Dispará el pipeline de build de producción (iOS + Android) de spendApp vía EAS Workflows.

## Qué hacer

1. Correr, desde la raíz del repo (`/Users/gabrielsk/Documents/Proyects/spendApp`):

   ```bash
   eas workflow:run .eas/workflows/build-produccion.yml
   ```

2. El pipeline corre en la infraestructura de EAS, no en esta sesión: primero el job `gate_calidad` (lint, `tsc --noEmit`, jest, y el chequeo de requisitos de tienda); si pasa, dispara en paralelo `build_ios` y `build_android` (perfil `production`).
3. Reportar el output tal cual lo imprime `eas-cli`, incluyendo el link al run en el dashboard de EAS — ahí se sigue el progreso en vivo de cada job.
4. Este pipeline **no sube nada a las stores**: termina en el build. Subir a TestFlight/Play sigue siendo un `eas submit` manual aparte, fuera de esta skill.

## Si falla

- Error de autenticación (`eas-cli` pide login): indicar que corra `eas login` una vez, después reintentar el mismo comando.
- Si `gate_calidad` falla: el output de `eas-cli` señala qué paso (lint/tsc/jest/requisitos de tienda) cortó la ejecución — no se disparan los builds. Hay que arreglar eso en el código antes de volver a correr la skill, no reintentar a ciegas.
```

- [ ] **Step 2: Verificar el frontmatter es válido (mismo formato que las otras skills del repo)**

Run:
```bash
node -e "const yaml = require('js-yaml'); const fs = require('fs'); const contenido = fs.readFileSync('.claude/skills/deploy-splitp2p/SKILL.md', 'utf8'); const bloque = contenido.split('---')[1]; console.log(JSON.stringify(yaml.load(bloque), null, 2));"
```
Expected: imprime `{ "name": "deploy-splitp2p", "description": "Dispara el pipeline de build de producción de spendApp (EAS Workflows) cuando el PO decide generar bundles nuevos para las stores." }` sin excepción.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/deploy-splitp2p/SKILL.md
git commit -m "docs(skills): skill de proyecto deploy-splitp2p para disparar el pipeline de build"
```
