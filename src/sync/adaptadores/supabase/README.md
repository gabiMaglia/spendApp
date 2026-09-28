# adaptadores/supabase — el buzón concreto
Implementa el puerto Transporte sobre Supabase (tabla envelopes + RPCs).
- `relay.ts`: fetchSince/deleteMyEnvelopes/subscribeTopic (+ fachada).
- `relaySend.ts`: sendEnvelope (compactable por ckey, AbortSignal).
- `relayClient.ts`: cliente, `MAX_PAYLOAD_BYTES` = 1 MB (`006_payload_limit.sql`).
- `relayErrors.ts`: clasifica errores PostgREST (función ausente, cuota).
- `ownerPledge.ts`: prenda de escritura para borrar lo propio (ADR-009).
Invariantes: el push realtime es un AVISO, la verdad se lee por cursor;
los sobres llevan ESTADO (TTL 30 días sin pérdida si hay renovación).
Degradados por sesión si falta una migración (011a, 010).
Migraciones: `supabase/001…011b`. El PO las aplica a mano.
Otro servidor = otro adaptador que cumpla el mismo puerto.
Depende de: `store/*` (claves/sesión, deuda declarada), `@supabase/supabase-js`. Lo usan: `motor/`, `nucleo/abrirSobre.ts` (tipo `Envelope`), `sesion/`, `confianza/`, `contactos/`, `invitaciones/`.
Tests: `adaptadores/supabase/__tests__` (+ `integration/`, contra Supabase local).
