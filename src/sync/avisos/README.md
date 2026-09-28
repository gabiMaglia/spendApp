# avisos — lo que el sync le cuenta a la persona
Traduce el diagnóstico del motor a avisos de bandeja, UNA vez por hecho.
- `syncDownNotices`: «este grupo dejó de sincronizar» (too_large/no_key).
- `clockNotice`: «tu reloj está mal» (T-038), se olvida solo al corregirse.
La marca de «ya avisé» se persiste; el fallo en sí vive en memoria.
Los hooks de React (`useManifestGap`, `useGroupSyncFailure`) viven en
`src/hooks/` (T-214): acá no hay React.
Consume puertos de salida del motor (Avisos): el sync no avisa, informa.
Textos: claves i18n (claveDeFalloDeSync), nunca strings en el sync.
Producto: no va al paquete.
Depende de: `motor/` (publishHealth, relaySync), `nucleo/manifestHealth`, `store/userScope`. Lo usan: `motor/relayEngine.ts`, `store/accountLink.ts`, `src/hooks/useManifestGap.ts`.
Leer: T-054, T-058, T-038.
Tests: `avisos/__tests__`.
