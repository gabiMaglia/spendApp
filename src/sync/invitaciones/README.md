# invitaciones — cómo entra alguien a un grupo
Invitación por link con token efímero; grant firmado; clave envuelta X25519.
- `groupInvite`: crear/parsear link, claim/grant sellados.
- `groupKeyWrap`: envoltura X25519 de la clave (v1 aceptada hasta 2026-10-14).
- `inviteEngine` (quien entra) · `inviteAdmit` (quien invita).
- `suscripciones` (ex `relay/invitaciones`): escuchar buzones de invitación.
- `groupKeyOffers` + `keyConflictNotice`: claves en disputa (T-136).
Por el relay de GRUPO nunca viaja una clave (ADR-003 §1): viaja por acá.
Producto: no va al paquete.
Depende de: `store/*` (authStore, groupKeyStore, groupStore, identityStore, userStore), `adaptadores/supabase/relay`, `motor/` (cursor, relaySync), `nucleo/` (envelopeCrypto, topes), `contactos/contactChannel`. Lo usan: `components/` (GroupKeyConflictCard, TabHeader), `contactos/`, `motor/relayEngine.ts`, `store/accountLink.ts`.
Leer: ADR-003 (enmienda T-034), ADR-013, T-172.
Tests: `invitaciones/__tests__`.
