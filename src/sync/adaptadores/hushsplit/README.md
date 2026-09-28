# adaptadores/hushsplit — el documento de HushSplit
Implementa el puerto Documento: qué es un grupo en esta app.
- `adaptadorHushSplit.ts`: campos (orden de dependencia), armar, envolver,
  acotar, aplicar, antesDePublicar, almacen (MMKV scopeado por cuenta).
- `acotarDeltaAlGrupo.ts`: el receptor desconfía (robo de id, dependencias).
- `applyDelta.ts`: merge LWW/por niveles en los stores de Zustand.
- `soloLocal.ts`: campos que no viajan (receiptImageUri, avatarUrl).
- `aplicarAcotado.ts`: acotar + aplicar + pedir fotos por referencia.
- `avatarTopic.ts` + `sliceRenewal.ts`: la foto viaja por su propio topic.
Regla: lo único que puede tocar stores del lado del sync es esta carpeta.
Nunca adopta claves de grupo (los campos groupKeys/personal van vacíos).
Depende de: `store/*` (todos los stores de dominio), `confianza/` (authorKeys, ratchet, recordHealth, recordSign, verdictCache), `motor/pendingDrain`. Lo usan: `nucleo/abrirSobre.ts` (tipo `SyncDelta`), `motor/`.
Leer: spec 2026-09-28-sync-extraible-design.md §2.2 (V4, frontera con `SyncDelta`), engram/02_architecture.md:298-581 (ADR-003).
Tests: `adaptadores/hushsplit/__tests__` (relayScope, mergeGate, acotar*).
