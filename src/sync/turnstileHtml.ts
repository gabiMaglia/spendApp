/**
 * HTML servido al WebView invisible que hospeda el widget de Cloudflare
 * Turnstile (T-147 P-3). El widget corre en modo Managed +
 * `appearance: 'interaction-only'`: la mayoría de las veces resuelve solo, sin
 * mostrar nada, y sólo pide interacción cuando Cloudflare lo considera
 * necesario — recién ahí `CaptchaHost` muestra la hoja.
 */

export type TurnstileMsg =
  | { type: 'token'; token: string }
  | { type: 'error'; code: string }
  | { type: 'expired' }
  | { type: 'interactive' }
  | { type: 'height'; height: number };

/** Tope del alto que se acepta desde el WebView — un valor fuera de rango se
 *  descarta en `parseTurnstileMessage`, nunca se aplica a ciegas. */
const ALTO_MAX_ACEPTADO = 600;

/**
 * La site key **nunca se concatena cruda**: se inserta con `JSON.stringify` y
 * se escapa `<` a `<` para que no pueda cerrar el `<script>` que la
 * envuelve (la site key viaja pública, pero un valor hostil en el `.env` no
 * debería poder inyectar HTML/JS en la página que la app misma sirve).
 */
export function turnstileHtml(siteKey: string): string {
  const siteKeyJs = JSON.stringify(siteKey).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=cargado" async defer></script>
</head>
<body style="margin:0;padding:0;">
  <div id="turnstile"></div>
  <script>
    function enviar(msg) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
    function cargado() {
      turnstile.render('#turnstile', {
        sitekey: ${siteKeyJs},
        appearance: 'interaction-only',
        size: 'flexible',
        callback: function (token) { enviar({ type: 'token', token: token }); },
        'error-callback': function (code) { enviar({ type: 'error', code: String(code) }); },
        'expired-callback': function () { enviar({ type: 'expired' }); },
        'before-interactive-callback': function () { enviar({ type: 'interactive' }); },
      });
    }
    // El desafío de Turnstile puede medir más que la casilla que le da la
    // app (Android, tamaño 'flexible'): se informa el alto real del body
    // para que la app agrande el contenedor en vez de cortarlo. Debounce
    // simple para no inundar el puente con cada micro-cambio de layout.
    var alturaTimeout = null;
    function informarAltura() {
      if (alturaTimeout) clearTimeout(alturaTimeout);
      alturaTimeout = setTimeout(function () {
        enviar({ type: 'height', height: document.body.scrollHeight });
      }, 50);
    }
    new ResizeObserver(informarAltura).observe(document.body);
  </script>
</body>
</html>`;
}

export function parseTurnstileMessage(raw: string): TurnstileMsg | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;

  switch (m.type) {
    case 'token':
      return typeof m.token === 'string' ? { type: 'token', token: m.token } : null;
    case 'error':
      return typeof m.code === 'string' ? { type: 'error', code: m.code } : null;
    case 'expired':
      return { type: 'expired' };
    case 'interactive':
      return { type: 'interactive' };
    case 'height':
      return typeof m.height === 'number' && Number.isFinite(m.height) && m.height >= 0 && m.height <= ALTO_MAX_ACEPTADO
        ? { type: 'height', height: m.height }
        : null;
    default:
      return null;
  }
}
