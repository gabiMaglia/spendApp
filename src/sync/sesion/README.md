# sesion — con qué credencial se habla con el buzón
Sesión de Supabase del buzón (anónima o de cuenta) y su persistencia cifrada.
- `relaySession.ts`: ensureRelaySession, refresco atado a primer plano.
- `relaySessionStorage.ts`: storage cifrado, marcador de dueño, cola FIFO.
- `directoryAuth.ts`: sesión de CUENTA (Google/Apple → Supabase Auth).
- `accountEntry.ts`: reconexión de cuenta (T-147-b).
- `captchaBridge.ts` + `turnstileHtml.ts`: Turnstile para signInAnonymously.
- `relayNetworkTimeout.ts`: timeout de red que se pausa con el captcha.
- `sessionStatus.ts`: «no hay sesión de sync» para la UI.
No es parte del paquete: otro servidor autentica distinto.
El motor sólo necesita saber si hay sesión (puerto Identidad.sesion).
Depende de: `adaptadores/supabase/relay`, `confianza/deviceKeys`, `store/authStore`. Lo usan: `components/` (SinSesionDeSync, TurnstileWidget), `motor/`, `store/session.ts`.
Leer: T-147 (engram/plans), `011b_relay_rls_corte.sql`.
Tests: `sesion/__tests__` (relaySession*, estadosDeSesion*, directoryAuth*).
