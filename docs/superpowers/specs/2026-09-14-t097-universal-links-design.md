# T-097 — Universal Links y página sin esquema en iOS (cierra SEC M-4)

- **Fecha:** 2026-09-14
- **Ticket:** T-097 · hallazgo M-4 de la auditoría de seguridad #2 (`engram/qa/SEC2*.md`).
- **Nivel:** Standard, con QA (superficie de links).
- **Obligatorio:** antes del lanzamiento público en App Store. No bloquea la beta.
- **Decisiones del PO (2026-09-14):**
  - cuando cae la página en iOS, Smart App Banner y nunca el esquema (opción A);
  - App Store id `6801922014`;
  - Apple Team ID `4GP6785MU4`.

## 1. Problema

Los links que comparte la app son `https://spendapp.github.io/#<fragmento>`, con el secreto de contacto o el token de invitación en el fragmento. La página `docs/web/abrir.html` los reenvía en iOS a `spendapp://<ruta>?<params>` (`abrir.html:182`). iOS no define qué app gana cuando dos declaran el mismo esquema: una app maliciosa que declare `spendapp` recibe el secreto. No hay `com.apple.developer.associated-domains`. Con publicación sólo iOS, afecta al 100 % de los usuarios.

## 2. Objetivo y no-objetivos

**Objetivos:**
- En iOS, ningún camino envía datos de un link por `spendapp://`.
- Con la app instalada, el link `https` abre spendApp directo (Universal Link).

**No-objetivos:**
- App Links de Android: se publica sólo iOS, y el `intent://…;package=com.splitp2p.app` actual está atado al paquete.
- Dejar de aceptar `spendapp://` en la app, que se sigue usando en desarrollo y no filtra datos hacia afuera.
- Dominio propio.

## 3. Diseño

### 3.1 Valores únicos — `src/constants/web.ts`

Agregar:

```ts
/** Apple Developer Team ID (PO, 2026-09-14). Arma el appID del AASA: `<TEAM>.<bundle>`. */
export const APPLE_TEAM_ID = '4GP6785MU4';
/** Id de spendApp en App Store (PO, 2026-09-14). Smart App Banner y link a la tienda. */
export const APP_STORE_ID = '6801922014';
```

No se duplican en ningún otro lado sin un test que los compare (§4).

### 3.2 App — `app.json` (nativo)

- `expo.ios.associatedDomains: ["applinks:spendapp.github.io"]` genera el entitlement `com.apple.developer.associated-domains`. EAS sincroniza la capability del App ID en el build.
- Requiere `npx expo prebuild --clean` y recompilar.
- Android no cambia.

### 3.3 AASA — `docs/web/.well-known/apple-app-site-association` (sin extensión)

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

- Sólo esos cuatro fragmentos abren la app: son la lista cerrada de `TIPOS_COMPACTOS` y `RUTAS_ENLAZABLES` (`src/utils/appLink.ts`). La raíz sin fragmento, las legales y el borrado de cuenta se siguen abriendo en el navegador.
- `scripts/publicar-sitio.sh` ya copia `docs/web/.well-known/` (T-134) y el sitio lleva `.nojekyll`.

### 3.4 Recepción en la app

- iOS entrega `https://spendapp.github.io/#…`. `app/+native-intent.tsx` llama a `destinoDeUrlExterna` (`src/utils/intencionNativa.ts`), que ya reconoce `ENLACE_BASE` en cualquier capitalización y lo pasa por `hrefInterno` y la lista blanca.
- Se agregan tests del camino Universal Link (§4). Si expo-router entrega otra forma de la URL a `redirectSystemPath`, `destinoDeUrlExterna` se ajusta para aceptarla y los tests la fijan.

### 3.5 Página — `docs/web/abrir.html`, rama iOS

Detección de iOS por user agent: `iPhone|iPad|iPod`, más `Macintosh` con `navigator.maxTouchPoints > 1` para iPadOS.

1. **Se elimina en iOS todo salto a `spendapp://`:** ni `window.location.replace` ni un `href` de botón con el esquema.
2. **Smart App Banner:** antes de mostrar el contenido, el script inserta en `<head>`:
   `<meta name="apple-itunes-app" content="app-id=6801922014, app-argument=<location.href completo, con fragmento>">`.
   Con la app instalada, Safari muestra «Abrir» y le entrega esa URL a spendApp. Sin la app, lleva a la tienda.
3. **Texto de ayuda** (claves nuevas en el objeto de traducciones existente de la página, en es, en y pt):
   - es: «Si no se abre sola: mantené apretado el link y elegí "Abrir en spendApp", o abrilo desde Safari.»
   - en: «If it doesn't open by itself: press and hold the link and choose "Open in spendApp", or open it in Safari.»
   - pt: «Se não abrir sozinho: mantenha o link pressionado e escolha "Abrir no spendApp", ou abra no Safari.»
4. **Botón «Descargar spendApp»** / «Get spendApp» / «Baixar spendApp» → `https://apps.apple.com/app/id6801922014`.
5. **Android** sigue con `intent://<ruta>?<query>#Intent;scheme=spendapp;package=…;end`. **Escritorio** sigue con la página explicativa.
6. **CSP:** se recalculan los hashes `sha256` del script y del estilo. `img-src` sigue en `'none'`, porque el banner lo dibuja Safari.

**Respaldo si Safari ignora la `meta` insertada por script:** el banner abre la app sin el link. Quedan el texto de ayuda («mantener apretado → Abrir en spendApp», que dispara el Universal Link con la URL completa) y la apertura desde Safari. M-4 sigue cerrado: en iOS ningún camino usa el esquema.

## 4. Tests

Todos son de comportamiento y tienen prueba de rojo contra `main`.

**`src/__tests__/universalLinks.test.ts` (nuevo)**
1. `app.json` → `expo.ios.associatedDomains` contiene `applinks:spendapp.github.io`, derivado de `BASE_URL`.
2. El AASA existe, es JSON válido y su `appIDs` es exactamente `[`${APPLE_TEAM_ID}.${app.json ios.bundleIdentifier}`]`.
3. El conjunto de patrones `#` del AASA es exactamente `{<letra>* por cada clave de TIPOS_COMPACTOS} ∪ {<ruta>* por cada RUTAS_ENLAZABLES}`. Falla por diferencia, en las dos direcciones.
4. Todo componente tiene `"/": "/"` y un `#` no vacío: ninguno abre la raíz sin fragmento ni otra ruta.
5. `docs/web/abrir.html` contiene `APP_STORE_ID` en el banner y en el link a la tienda.

**`src/utils/__tests__/intencionNativa.test.ts` (ampliado)**
- `https://spendapp.github.io/#c<código válido>` lleva a `contact/add?c=…`, y `#g<código>` a `groups/join?c=…`.
- Las variantes `HTTPS://SPENDAPP.GITHUB.IO/#c…` y `https://spendapp.github.io#c…` (sin barra) también.
- `https://spendapp.github.io/#settle/new?x=1` va a `/`.
- `https://spendapp.github.io.evil.com/#c…` y `https://evil.com/?spendapp.github.io#c…` van a `/`.

**`src/__tests__/paginaAbrir.test.ts` (ampliado)**, ejecutando el script con un DOM simulado:
- Con user agent de iPhone y de iPadOS (Macintosh con touch) y un fragmento válido:
  - no hay asignación de `location` ni `href` que empiece con `spendapp:`;
  - existe `meta[name=apple-itunes-app]` con `app-id=6801922014` y `app-argument` igual al `href` completo;
  - se ven el texto de ayuda y el botón a `https://apps.apple.com/app/id6801922014`.
- Con user agent de Android, el `href` sigue siendo `intent://…;package=com.splitp2p.app;end`.
- Los hashes de la CSP coinciden con el contenido real de `<script>` y `<style>` (test existente).
- Las traducciones nuevas existen en es, en y pt.

## 5. Verificación

**Después de publicar el sitio** (Orquestador):
1. `curl -sI https://spendapp.github.io/.well-known/apple-app-site-association` responde 200, sin redirección, y el cuerpo es igual al archivo del repo.
2. `curl -s https://app-site-association.cdn-apple.com/a/v1/spendapp.github.io` devuelve el JSON. La CDN de Apple puede tardar hasta unas 24 h.

**En aparato** (PO), con un build de TestFlight que tenga el entitlement:
1. Tocar un link de contacto desde Notas o Mensajes: abre spendApp directo en la pantalla correcta.
2. Desde el navegador interno de WhatsApp: cae la página, el banner «Abrir» lleva a la pantalla correcta. Si llega sin link, confirmar que «mantener apretado → Abrir en spendApp» funciona y anotar el resultado.
3. Con la app desinstalada: la página no intenta abrir `spendapp://` y el botón lleva a la App Store.
4. Android: sin cambios.

**Orden de publicación:** primero el sitio con el AASA; después el build con el entitlement. Un build sin AASA publicado sólo abre los links en la página, sin romper nada.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| GitHub Pages sirve el AASA como `application/octet-stream` y la CDN de Apple no lo toma | Verificación §5.2; respaldo: servirlo también en `/apple-app-site-association` (raíz) y repetir |
| Safari ignora la `meta apple-itunes-app` insertada por script | Texto de ayuda + apertura desde Safari (§3.5); M-4 cerrado igual |
| expo-router entrega la URL del Universal Link en otra forma | Tests de §4 y ajuste en `destinoDeUrlExterna` (§3.4) |
| Team ID o App Store id cambian | Viven sólo en `web.ts`; los tests atan AASA, página y `app.json` a esos valores |
| Peor experiencia en navegadores internos (un toque más) | Aceptado por el PO a cambio de cerrar M-4 |
