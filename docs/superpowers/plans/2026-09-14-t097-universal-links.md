# T-097 · Universal Links y página sin esquema en iOS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que en iOS los links `https://spendapp.github.io/#…` abran spendApp directo por Universal Link, y que la página `abrir.html` nunca más mande datos por `spendapp://` en iOS (cierra SEC M-4).

**Architecture:**
- Los valores de Apple (Team ID, App Store id) viven en `src/constants/web.ts`.
- `app.json` declara `applinks:spendapp.github.io`.
- El sitio publica un AASA que habilita sólo los cuatro fragmentos enlazables.
- En la rama iOS de la página, el script inserta el Smart App Banner y convierte el botón en «Descargar» hacia la App Store, sin salto al esquema.
- La app ya acepta la URL `https` en `destinoDeUrlExterna`; se fija ese contrato con tests.

**Tech Stack:** Expo SDK 54 / Expo Router v6, TypeScript, Jest (con `vm` de Node para ejecutar el script de la página), GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-09-14-t097-universal-links-design.md`

## Global Constraints

- Apple Team ID: `4GP6785MU4`. App Store id: `6801922014`. Bundle: `com.splitp2p.app` (de `app.json`).
- Dominio asociado: `applinks:spendapp.github.io`.
- AASA en `docs/web/.well-known/apple-app-site-association` (sin extensión), con `appIDs` `["4GP6785MU4.com.splitp2p.app"]` y componentes `#c*`, `#g*`, `#contact/add*`, `#groups/join*`, todos con `"/": "/"`.
- Link a la tienda: `https://apps.apple.com/app/id6801922014`.
- Meta del banner: `<meta name="apple-itunes-app" content="app-id=6801922014, app-argument=<window.location.href>">`.
- En iOS la página no asigna `location` ni un `href` que empiece con `spendapp:`. Android sigue con `intent://…#Intent;scheme=spendapp;package=com.splitp2p.app;end`.
- Textos nuevos de la página, verbatim:
  - es: ayuda «Si no se abre sola: mantené apretado el link y elegí "Abrir en spendApp", o abrilo desde Safari.»; botón «Descargar spendApp».
  - en: «If it doesn't open by itself: press and hold the link and choose "Open in spendApp", or open it in Safari.»; «Get spendApp».
  - pt: «Se não abrir sozinho: mantenha o link pressionado e escolha "Abrir no spendApp", ou abra no Safari.»; «Baixar spendApp».
- La CSP de `abrir.html` sigue con `default-src 'none'`, `img-src 'none'`, `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`, con hashes recalculados.
- App Links de Android fuera de alcance.
- Nivel Standard → QA antes de merge. Rama `fix/T-097-universal-links`.
- Worktrees con `node_modules` por symlink, nunca `npm install`. Cambio nativo (`associatedDomains`) → `npx expo prebuild --clean` en el build.
- Verificación de rutina: `npx jest`, `npx tsc --noEmit`, `npm run lint` (base 127 warnings / 0 errores).
- Commits terminan con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/constants/web.ts` | Modificar | `APPLE_TEAM_ID`, `APP_STORE_ID` |
| `app.json` | Modificar (`expo.ios`) | `associatedDomains` |
| `docs/web/.well-known/apple-app-site-association` | Crear | AASA |
| `src/__tests__/universalLinks.test.ts` | Crear | Coherencia app.json ↔ AASA ↔ constantes ↔ rutas |
| `src/utils/__tests__/intencionNativa.test.ts` | Modificar (agregar) | Contrato de la URL de Universal Link |
| `docs/web/abrir.html` | Modificar (script, textos, comentario, CSP) | Rama iOS sin esquema + banner |
| `src/__tests__/paginaAbrir.test.ts` | Modificar (agregar) | Ejecutar el script por plataforma |
| `engram/05_handoff_log.md`, `engram/03_backlog.md` | Modificar | Handoff y estado (gitignored) |

---

### Task 1: Constantes, dominio asociado y AASA

**Files:**
- Modify: `src/constants/web.ts` (final del archivo)
- Modify: `app.json` (bloque `expo.ios`, líneas 11-19)
- Create: `docs/web/.well-known/apple-app-site-association`
- Test: `src/__tests__/universalLinks.test.ts`

**Interfaces:**
- Consumes: `BASE_URL` (`src/constants/web.ts`), `RUTAS_ENLAZABLES` y `TIPOS_COMPACTOS` (`src/utils/appLink.ts`).
- Produces: `export const APPLE_TEAM_ID: string` y `export const APP_STORE_ID: string` en `src/constants/web.ts`. La Task 3 los usa en su test.

- [ ] **Step 1: Crear la rama**

```bash
cd /Users/gabrielsk/Documents/Proyects/spendApp
git checkout main && git pull -q && git checkout -b fix/T-097-universal-links
```

- [ ] **Step 2: Escribir el test que falla**

Crear `src/__tests__/universalLinks.test.ts`:

```ts
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { APP_STORE_ID, APPLE_TEAM_ID, BASE_URL } from '@/src/constants/web';
import { RUTAS_ENLAZABLES, TIPOS_COMPACTOS } from '@/src/utils/appLink';

/**
 * **Universal Links (T-097 · SEC M-4).**
 *
 * Tres archivos tienen que decir lo mismo y ninguno lo sabe del otro: `app.json` (el
 * dominio asociado), el AASA publicado en el sitio (qué app y qué fragmentos) y las
 * constantes de `web.ts`. Si se desincronizan, iOS no abre la app y el link cae a la
 * página: no rompe nada visible, así que sólo un test lo detecta.
 */
const RAIZ = join(__dirname, '..', '..');
const APP = JSON.parse(readFileSync(join(RAIZ, 'app.json'), 'utf8')).expo;
const RUTA_AASA = join(RAIZ, 'docs', 'web', '.well-known', 'apple-app-site-association');

type Componente = { '/': string; '#': string; comment?: string };
type Aasa = { applinks: { details: { appIDs: string[]; components: Componente[] }[] } };

const aasa = (): Aasa => JSON.parse(readFileSync(RUTA_AASA, 'utf8'));

describe('Universal Links (T-097)', () => {
  it('los valores de Apple son los del PO', () => {
    expect(APPLE_TEAM_ID).toBe('4GP6785MU4');
    expect(APP_STORE_ID).toBe('6801922014');
  });

  it('app.json declara el dominio del sitio como dominio asociado', () => {
    const host = new URL(BASE_URL).host;
    expect(APP.ios.associatedDomains).toEqual([`applinks:${host}`]);
  });

  it('el AASA existe y es JSON válido', () => {
    expect(existsSync(RUTA_AASA)).toBe(true);
    expect(() => aasa()).not.toThrow();
  });

  it('el AASA habilita exactamente esta app: <TEAM>.<bundle>', () => {
    const details = aasa().applinks.details;
    expect(details).toHaveLength(1);
    expect(details[0].appIDs).toEqual([`${APPLE_TEAM_ID}.${APP.ios.bundleIdentifier}`]);
  });

  it('los fragmentos del AASA son exactamente los enlazables de la app, ni uno más', () => {
    const esperados = [
      ...Object.keys(TIPOS_COMPACTOS).map((letra) => `${letra}*`),
      ...RUTAS_ENLAZABLES.map((ruta) => `${ruta}*`),
    ].sort();
    const reales = aasa().applinks.details[0].components.map((c) => c['#']).sort();
    expect(reales).toEqual(esperados);
  });

  it('ningún componente abre la raíz sin fragmento ni otra ruta del sitio', () => {
    for (const c of aasa().applinks.details[0].components) {
      expect(c['/']).toBe('/');
      expect(typeof c['#']).toBe('string');
      expect(c['#'].length).toBeGreaterThan(1);
    }
  });
});
```

- [ ] **Step 3: Correr el test y confirmar que falla (prueba de rojo)**

Run: `npx jest src/__tests__/universalLinks.test.ts`
Expected: FAIL.
- «los valores de Apple…»: `APPLE_TEAM_ID` es `undefined`.
- «app.json declara…»: `associatedDomains` es `undefined`.
- «el AASA existe…»: `existsSync` da `false`.
- Los dos tests del AASA: `ENOENT`.

Anotar la salida.

- [ ] **Step 4: Agregar las constantes**

Al final de `src/constants/web.ts`:

```ts

/**
 * Apple Developer Team ID (PO, 2026-09-14). Arma el appID del AASA del sitio:
 * `<TEAM>.<bundleIdentifier>` (T-097). Un test lo ata a `app.json` y al AASA.
 */
export const APPLE_TEAM_ID = '4GP6785MU4';

/**
 * Id de spendApp en App Store (PO, 2026-09-14). Lo usan el Smart App Banner y el botón
 * «Descargar» de `docs/web/abrir.html` (T-097).
 */
export const APP_STORE_ID = '6801922014';
```

- [ ] **Step 5: Declarar el dominio asociado**

En `app.json`, dentro de `expo.ios`, reemplazar:

```json
      "bundleIdentifier": "com.splitp2p.app",
      "usesAppleSignIn": true,
```

por:

```json
      "bundleIdentifier": "com.splitp2p.app",
      "usesAppleSignIn": true,
      "associatedDomains": ["applinks:spendapp.github.io"],
```

- [ ] **Step 6: Crear el AASA**

Crear `docs/web/.well-known/apple-app-site-association` (sin extensión) con exactamente:

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["4GP6785MU4.com.splitp2p.app"],
        "components": [
          { "/": "/", "#": "c*", "comment": "contacto, formato compacto" },
          { "/": "/", "#": "g*", "comment": "invitación, formato compacto" },
          { "/": "/", "#": "contact/add*", "comment": "contacto, formato largo" },
          { "/": "/", "#": "groups/join*", "comment": "invitación, formato largo" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 7: Correr el test y confirmar que pasa**

Run: `npx jest src/__tests__/universalLinks.test.ts src/__tests__/publicarSitio.test.ts`
Expected: PASS. `publicarSitio` ya exige que el script copie `.well-known`.

- [ ] **Step 8: Commit**

```bash
git add src/constants/web.ts app.json docs/web/.well-known/apple-app-site-association src/__tests__/universalLinks.test.ts
git commit -m "feat(links): dominio asociado y AASA para Universal Links (T-097)

APPLE_TEAM_ID y APP_STORE_ID en constants/web; applinks:spendapp.github.io;
AASA con los cuatro fragmentos enlazables. Un test ata los tres.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Contrato de la URL de Universal Link en la app

**Files:**
- Test: `src/utils/__tests__/intencionNativa.test.ts` (final del archivo)
- Modify (sólo si algún test falla): `src/utils/intencionNativa.ts`

**Interfaces:**
- Consumes: `destinoDeUrlExterna(pathCrudo: string, isDev?: boolean): string` y `enlaceCompacto(tipo: 'c' | 'g', codigo: string): string`, ya importados en el archivo de test.
- Produces: nada nuevo.

- [ ] **Step 1: Escribir los tests del contrato**

Agregar al final de `src/utils/__tests__/intencionNativa.test.ts`:

```ts
describe('destinoDeUrlExterna · Universal Link (T-097)', () => {
  // Con `applinks:spendapp.github.io`, iOS entrega a la app la URL https completa que se
  // tocó, fragmento incluido. Tiene que caer en la misma lista blanca que el esquema.
  it('el link compacto https abre su pantalla', () => {
    expect(destinoDeUrlExterna('https://spendapp.github.io/#cABC_-')).toBe('/contact/add?c=ABC_-');
    expect(destinoDeUrlExterna('https://spendapp.github.io/#gXYZ')).toBe('/groups/join?c=XYZ');
    expect(destinoDeUrlExterna(enlaceCompacto('c', 'QWE'))).toBe('/contact/add?c=QWE');
  });

  it('el formato largo https abre su pantalla', () => {
    expect(destinoDeUrlExterna('https://spendapp.github.io/#contact/add?id=u1&name=Ada'))
      .toBe('/contact/add?id=u1&name=Ada');
  });

  it.each([
    'HTTPS://SPENDAPP.GITHUB.IO/#cABC_-',
    'https://spendapp.github.io#cABC_-',
  ])('mayúsculas en esquema/host y la variante sin barra también: %s', (url) => {
    expect(destinoDeUrlExterna(url)).toBe('/contact/add?c=ABC_-');
  });

  it.each([
    'https://spendapp.github.io/#settle/new?toId=x&maxAmount=999',
    'https://spendapp.github.io/#debug/identity',
    'https://spendapp.github.io/',
    'https://spendapp.github.io.evil.com/#cABC_-',
    'https://evil.com/?spendapp.github.io#cABC_-',
    'https://evil.com/#cABC_-',
  ])('un https que no es un link enlazable del sitio va al inicio: %s', (url) => {
    expect(destinoDeUrlExterna(url)).toBe('/');
  });
});
```

- [ ] **Step 2: Correr los tests**

Run: `npx jest src/utils/__tests__/intencionNativa.test.ts`

Expected: PASS. `destinoDeUrlExterna` ya reconoce `ENLACE_BASE` en cualquier capitalización y `rutaDeEnlace` exige `base#`. Estos tests fijan el contrato, así que no se espera rojo.
- **Si alguno falla:** es un hueco real. Corregir `src/utils/intencionNativa.ts`, o `rutaDeEnlace` en `src/utils/appLink.ts`, con el cambio mínimo para que ese caso cumpla la expectativa. Anotar en el handoff qué caso falló y qué se cambió.
- **Mutación, para comprobar que los tests no son vacuos:** en `intencionNativa.ts`, cambiar temporalmente la línea `if (enMinuscula.startsWith(ENLACE_BASE.replace(/\/$/, '').toLowerCase())) return hrefInterno(path) ?? '/';` por `if (enMinuscula.startsWith(ENLACE_BASE.replace(/\/$/, '').toLowerCase())) return '/';`. Correr el mismo comando y ver que caen los tests de «abre su pantalla». Revertir con `git checkout -- src/utils/intencionNativa.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/utils/__tests__/intencionNativa.test.ts
git commit -m "test(links): contrato de la URL de Universal Link en destinoDeUrlExterna (T-097)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Si el Step 2 obligó a tocar código, sumar ese archivo al `git add` y mencionarlo en el mensaje.

---

### Task 3: Página sin esquema en iOS, con Smart App Banner

**Files:**
- Modify: `docs/web/abrir.html` (comentario inicial, objeto `TEXTOS`, constantes del script y bloque final desde `var destino = ruta + '?' + query;` hasta el cierre `})();`, más la CSP de la línea 8)
- Test: `src/__tests__/paginaAbrir.test.ts` (imports y final del archivo)

**Interfaces:**
- Consumes: `APP_STORE_ID` (Task 1, `src/constants/web.ts`).
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Escribir los tests que fallan**

En `src/__tests__/paginaAbrir.test.ts`, reemplazar la línea de imports:

```ts
import { BASE_URL, LINKS_URL } from '@/src/constants/web';
```

por:

```ts
import * as vm from 'vm';
import { APP_STORE_ID, BASE_URL, LINKS_URL } from '@/src/constants/web';
```

Y agregar al final del archivo:

```ts
/**
 * Ejecuta el script real de la página con un `window`/`document`/`navigator` mínimos.
 * No hay navegador en Jest: esto alcanza para ver QUÉ hace la página por plataforma
 * (a dónde manda, qué muestra), que es lo que protege el secreto del link (T-097).
 */
function ejecutarPagina(opts: { userAgent: string; hash: string; maxTouchPoints?: number; language?: string }) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(HTML)![1];
  const elementos: Record<string, { textContent: string; href: string; hidden: boolean }> = {};
  const el = (id: string) => (elementos[id] ??= { textContent: '', href: '', hidden: true });
  const metas: Record<string, string>[] = [];
  const replace = jest.fn();
  const location = { hash: opts.hash, href: `https://spendapp.github.io/${opts.hash}`, replace };
  const document = {
    documentElement: { lang: 'es' },
    title: '',
    getElementById: el,
    createElement: () => {
      const attrs: Record<string, string> = {};
      return { attrs, setAttribute: (k: string, v: string) => { attrs[k] = v; } };
    },
    head: { appendChild: (nodo: { attrs: Record<string, string> }) => { metas.push(nodo.attrs); } },
  };
  vm.runInNewContext(script, {
    window: { location },
    document,
    navigator: { userAgent: opts.userAgent, language: opts.language ?? 'es', maxTouchPoints: opts.maxTouchPoints ?? 0 },
  });
  return { elementos, metas, replace, location };
}

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_IPADOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

describe('docs/web/abrir.html en iOS (T-097 · SEC M-4)', () => {
  it.each([
    ['iPhone', UA_IPHONE, 0],
    ['iPadOS (Macintosh con touch)', UA_IPADOS, 5],
  ])('%s: nunca manda el link por spendapp://', (_n, userAgent, maxTouchPoints) => {
    const { elementos, replace } = ejecutarPagina({ userAgent, maxTouchPoints, hash: '#cABC_-' });
    expect(replace).not.toHaveBeenCalled();
    for (const e of Object.values(elementos)) expect(e.href).not.toMatch(/^spendapp:/i);
  });

  it('iPhone: pone el Smart App Banner con la URL completa, fragmento incluido', () => {
    const { metas, location } = ejecutarPagina({ userAgent: UA_IPHONE, hash: '#cABC_-' });
    expect(metas).toEqual([
      { name: 'apple-itunes-app', content: `app-id=${APP_STORE_ID}, app-argument=${location.href}` },
    ]);
    expect(location.href).toContain('#cABC_-');
  });

  it('iPhone: el botón lleva a la App Store y la nota explica cómo abrirla', () => {
    const { elementos } = ejecutarPagina({ userAgent: UA_IPHONE, hash: '#cABC_-' });
    expect(elementos.abrir.href).toBe(`https://apps.apple.com/app/id${APP_STORE_ID}`);
    expect(elementos.abrir.textContent).toBe('Descargar spendApp');
    expect(elementos.nota.textContent).toBe('Si no se abre sola: mantené apretado el link y elegí "Abrir en spendApp", o abrilo desde Safari.');
    expect(elementos.valido.hidden).toBe(false);
  });

  it.each([
    ['en', 'Get spendApp', 'If it doesn\'t open by itself: press and hold the link and choose "Open in spendApp", or open it in Safari.'],
    ['pt', 'Baixar spendApp', 'Se não abrir sozinho: mantenha o link pressionado e escolha "Abrir no spendApp", ou abra no Safari.'],
  ])('iPhone en %s: textos traducidos', (language, boton, nota) => {
    const { elementos } = ejecutarPagina({ userAgent: UA_IPHONE, hash: '#cABC_-', language });
    expect(elementos.abrir.textContent).toBe(boton);
    expect(elementos.nota.textContent).toBe(nota);
  });

  it('Android sigue abriendo con intent:// atado al paquete', () => {
    const { elementos, replace, metas } = ejecutarPagina({ userAgent: UA_ANDROID, hash: '#cABC_-' });
    const esperado = 'intent://contact/add?c=ABC_-#Intent;scheme=spendapp;package=com.splitp2p.app;end';
    expect(elementos.abrir.href).toBe(esperado);
    expect(replace).toHaveBeenCalledWith(esperado);
    expect(metas).toEqual([]);
  });

  it('en iOS un link inválido sigue mostrando «incompleto», sin banner', () => {
    const { elementos, metas, replace } = ejecutarPagina({ userAgent: UA_IPHONE, hash: '#settle/new?x=1' });
    expect(elementos.invalido.hidden).toBe(false);
    expect(metas).toEqual([]);
    expect(replace).not.toHaveBeenCalled();
  });

  it('el id de la App Store de la página es el de constants/web', () => {
    expect(HTML).toContain(`var APP_STORE_ID = '${APP_STORE_ID}'`);
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan (prueba de rojo)**

Run: `npx jest src/__tests__/paginaAbrir.test.ts`

Expected: FAIL en el describe nuevo:
- iPhone e iPadOS: `replace` fue llamado con `spendapp://contact/add?c=ABC_-` y el `href` empieza con `spendapp:`;
- `metas` vacío;
- botón y nota con los textos viejos;
- no existe `var APP_STORE_ID`.

Android y «link inválido» pasan. Anotar la salida.

- [ ] **Step 3: Agregar textos al objeto `TEXTOS`**

En `docs/web/abrir.html`, dentro de `TEXTOS.es`, reemplazar la línea:

```js
      abrir: 'Abrir en spendApp',
```

por:

```js
      abrir: 'Abrir en spendApp',
      descargar: 'Descargar spendApp',
      ayudaIos: 'Si no se abre sola: mantené apretado el link y elegí "Abrir en spendApp", o abrilo desde Safari.',
```

Dentro de `TEXTOS.en`, reemplazar `      abrir: 'Open in spendApp',` por:

```js
      abrir: 'Open in spendApp',
      descargar: 'Get spendApp',
      ayudaIos: 'If it doesn\'t open by itself: press and hold the link and choose "Open in spendApp", or open it in Safari.',
```

Dentro de `TEXTOS.pt`, reemplazar `      abrir: 'Abrir no spendApp',` por:

```js
      abrir: 'Abrir no spendApp',
      descargar: 'Baixar spendApp',
      ayudaIos: 'Se não abrir sozinho: mantenha o link pressionado e escolha "Abrir no spendApp", ou abra no Safari.',
```

- [ ] **Step 4: Constantes del script**

Reemplazar:

```js
  var PAQUETE_ANDROID = 'com.splitp2p.app';
```

por:

```js
  var PAQUETE_ANDROID = 'com.splitp2p.app';
  // T-097: id de la App Store (src/constants/web.ts, APP_STORE_ID; un test los ata).
  var APP_STORE_ID = '6801922014';
```

- [ ] **Step 5: Rama iOS**

Reemplazar el bloque final del script, desde la línea `  var destino = ruta + '?' + query;` hasta la línea `  window.location.replace(href);` inclusive, por:

```js
  texto('titulo', T[ruta][0]);
  texto('cuerpo', T[ruta][1]);
  var boton = document.getElementById('abrir');
  document.getElementById('valido').hidden = false;
  document.title = T.abrir;

  // iPadOS se presenta como Macintosh: se distingue por el touch.
  var ua = navigator.userAgent;
  var esIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  if (esIOS) {
    // T-097 · SEC M-4: en iOS cualquier app puede declarar `spendapp://` y recibir el
    // secreto del link. Acá NUNCA se usa el esquema. Con Universal Links la app abre sin
    // pasar por esta página; si igual se cargó (navegador interno, link pegado), el Smart
    // App Banner le entrega la URL https completa a spendApp, sin esquema de por medio.
    var meta = document.createElement('meta');
    meta.setAttribute('name', 'apple-itunes-app');
    meta.setAttribute('content', 'app-id=' + APP_STORE_ID + ', app-argument=' + window.location.href);
    document.head.appendChild(meta);
    texto('nota', T.ayudaIos);
    boton.textContent = T.descargar;
    boton.href = 'https://apps.apple.com/app/id' + APP_STORE_ID;
    return;
  }

  var destino = ruta + '?' + query;
  var esAndroid = /android/i.test(ua);
  // En Android, `intent://` es la forma confiable de abrir una app desde Chrome; con un
  // esquema pelado algunos navegadores no hacen nada. Lleva el paquete: sólo abre ESTA app.
  var href = esAndroid
    ? 'intent://' + destino + '#Intent;scheme=spendapp;package=' + PAQUETE_ANDROID + ';end'
    : 'spendapp://' + destino;

  texto('nota', T.nota);
  boton.textContent = T.abrir;
  boton.href = href;

  // Se intenta abrir solo. Muchos navegadores lo bloquean sin un toque del usuario, y
  // para eso está el botón.
  window.location.replace(href);
```

Controlar que las líneas anteriores al bloque reemplazado (`texto('titulo', …)`, `texto('cuerpo', …)`, `texto('nota', …)`, `var boton = …`, `document.getElementById('valido').hidden = false;`, `document.title = T.abrir;`) no queden duplicadas: si estaban entre `var href` y `window.location.replace`, ya quedaron dentro del reemplazo.

- [ ] **Step 6: Actualizar el comentario de cabecera**

En el comentario HTML inicial, reemplazar el párrafo:

```
  Gmail y casi cualquier cliente de mail o chat sólo convierten en link lo que empieza con
  http(s)://, así que la app comparte un link a esta página y la página abre la app con
  spendapp://.
```

por:

```
  Gmail y casi cualquier cliente de mail o chat sólo convierten en link lo que empieza con
  http(s)://, así que la app comparte un link a esta página.

  T-097 (SEC M-4): en iOS, con Universal Links (AASA en /.well-known/), el link abre la app
  sin pasar por acá. Si la página igual se carga, NUNCA usa spendapp:// —otra app podría
  declarar ese esquema y quedarse con el secreto—: muestra el Smart App Banner y un botón a
  la App Store. En Android abre con intent:// atado al paquete.
```

- [ ] **Step 7: Recalcular los hashes de la CSP**

```bash
cat > /tmp/t097-csp.js <<'EOF'
const fs = require('fs');
const crypto = require('crypto');
const p = 'docs/web/abrir.html';
let h = fs.readFileSync(p, 'utf8');
const hash = (s) => 'sha256-' + crypto.createHash('sha256').update(s, 'utf8').digest('base64');
const js = /<script>([\s\S]*?)<\/script>/.exec(h)[1];
const css = /<style>([\s\S]*?)<\/style>/.exec(h)[1];
h = h.replace(/script-src 'sha256-[^']+'/, `script-src '${hash(js)}'`)
     .replace(/style-src 'sha256-[^']+'/, `style-src '${hash(css)}'`);
fs.writeFileSync(p, h);
console.log('script', hash(js), '\nstyle', hash(css));
EOF
node /tmp/t097-csp.js && rm /tmp/t097-csp.js
```

- [ ] **Step 8: Correr los tests y confirmar que pasan**

Run: `npx jest src/__tests__/paginaAbrir.test.ts src/__tests__/universalLinks.test.ts`
Expected: PASS, incluido el test existente de los hashes de la CSP.

- [ ] **Step 9: Mutación**

Comentar temporalmente en `docs/web/abrir.html` la línea `    return;` del final de la rama `if (esIOS)`. No hace falta recalcular la CSP para esta prueba.
Run: `npx jest src/__tests__/paginaAbrir.test.ts` → Expected: FAIL en «nunca manda el link por spendapp://».
Revertir: `git checkout -- docs/web/abrir.html` y volver a aplicar los Steps 3 a 7. Una alternativa es deshacer sólo el comentario a mano y confirmar con `npx jest src/__tests__/paginaAbrir.test.ts` que vuelve a verde.

- [ ] **Step 10: Suite completa, tipos y lint**

Run: `npx jest 2>&1 | grep -E "^Tests:|failed"` → Expected: sin fallos.
Run: `npx tsc --noEmit` → Expected: sin salida.
Run: `npm run lint 2>&1 | grep problems` → Expected: `127 problems (0 errors, 127 warnings)`.

- [ ] **Step 11: Commit**

```bash
git add docs/web/abrir.html src/__tests__/paginaAbrir.test.ts
git commit -m "fix(security): en iOS la página nunca usa spendapp:// — Smart App Banner (T-097, SEC M-4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Handoff, backlog y verificación posterior

**Files:**
- Modify: `engram/05_handoff_log.md` (entrada nueva arriba), `engram/03_backlog.md` (fila T-097)

**Interfaces:**
- Consumes: commits de las Tasks 1-3.
- Produces: registro para QA y la lista de verificación posterior al merge. `engram/` está gitignored: no se commitea.

- [ ] **Step 1: Handoff**

Agregar arriba de la primera entrada `### [` de `engram/05_handoff_log.md`:

```markdown
### [2026-09-14] RETURN → Orq · T-097
- Rama `fix/T-097-universal-links` (3 commits). Spec y plan: `docs/superpowers/specs/2026-09-14-t097-universal-links-design.md`, `docs/superpowers/plans/2026-09-14-t097-universal-links.md`.
- Proof of red: Task 1 <pegar>; Task 3 <pegar>. Task 2: <«verde sin cambios» o qué caso falló y qué se tocó>.
- Mutaciones: Task 2 (intencionNativa → '/') <resultado>; Task 3 (`return` de la rama iOS comentado) <resultado>.
- **Después del merge (Orq, con OK del PO para publicar el sitio):**
  1. `scripts/publicar-sitio.sh`;
  2. `curl -sI https://spendapp.github.io/.well-known/apple-app-site-association` → 200 sin redirección y cuerpo igual al del repo;
  3. `curl -s https://app-site-association.cdn-apple.com/a/v1/spendapp.github.io` → JSON (hasta ~24 h).
  - Si la CDN no lo toma: copiar también el AASA a `docs/web/apple-app-site-association` (raíz), sumar esa copia a `publicar-sitio.sh` y repetir.
- **Aparato (PO, build con `prebuild --clean`):**
  1. link desde Notas abre la app directo;
  2. navegador interno de WhatsApp: banner «Abrir» (si llega sin link, «mantener apretado → Abrir en spendApp»);
  3. sin la app: botón a la App Store, sin intento de `spendapp://`;
  4. Android sin cambios.

```

- [ ] **Step 2: Backlog**

En `engram/03_backlog.md`, fila `T-097`: celda de estado (penúltima columna) → `En revisión QA (rama fix/T-097-universal-links)`.

- [ ] **Step 3: Confirmar**

Run: `git status --short` → Expected: sin cambios pendientes en el repo.
