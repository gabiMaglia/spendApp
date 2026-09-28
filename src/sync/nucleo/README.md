# nucleo — el protocolo, sin la app
Formato y algoritmos del sync por ESTADO sobre un buzón tonto. No importa nada
de `@/src/**` (store/services/components), `expo-*`, `react*` ni `@supabase/*`.
- Sobre: XChaCha20-Poly1305 (`envelopeCrypto`) + firma Ed25519 por fuera (`envelopeSign`).
- Topic = SHA256(clave‖época); ckey = SHA256(clave:ckey:campo:prefijo) (`ckey`).
- Cubos estables por prefijo de id (`cubos`) + profundidad con histéresis.
- Ledger de lo que YO publiqué (`sliceLedger`) y de lo que YA apliqué (`appliedSlices`).
- Manifiesto por emisor (`manifest`, `manifestHealth`) → detecta rebanadas faltantes; relectura acotada (`relecturas`).
- Cierre de drenaje puro (`cierreDeDrenaje`), presupuesto de reintentos (`drainFailures`), topes/límites de tamaño (`topes`, `limites`), ceder el hilo (`cederHilo`), armar el sobre publicable (`publicarCubos`, `abrirSobre`), hex↔bytes (`hexBytes`).
- Todo lo de afuera entra por `puertos/` (Almacen, Cripto, Log, Reloj).
Leer: docs/ADR-007, spec 2026-09-28-sync-extraible-design.md §2.2 (deuda declarada: `abrirSobre`/`drainFailures` todavía tocan tipos de `adaptadores/` y `services/errorLog`).
Regla: si necesitás un store acá, lo que falta es un puerto, no un import.
Depende de: `puertos/` y de sí mismo. Lo usan: `motor/`, `adaptadores/`, `confianza/`, `invitaciones/`, `avisos/`.
Tests: `nucleo/__tests__`, sin mocks de stores.
