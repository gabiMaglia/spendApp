# contactos — el buzón personal de cada persona
Canal por contacto: tarjeta propia, reenvío de claves de grupo, avisos.
- `contactChannel`: tarjeta, anuncio, drenaje del buzón de contactos.
- `contactPeers`: registro local de contactos · `contactTopic`: topic y clave.
- `contactGroupKeyDrop`: entrega de la clave de un grupo a un contacto (ADR-013).
- `contactInvite` + `contactInviteEngine`: link de contacto de un solo uso (ADR-015).
- `motorDeContactos` (ex `relay/contactos`): orquestación con ritmo (`relayQueue`).
Usa el MISMO transporte y el mismo sobre que el núcleo, con otra clave.
Depende de: `store/*` (authStore, groupKeyStore, groupStore, identityStore, userStore), `adaptadores/supabase/relay`, `invitaciones/` (groupInvite, groupKeyOffers, keyConflictNotice), `motor/` (agendaDePublicacion, agendaDeDrenaje, cursor, pendingDrain). Lo usan: `confianza/`, `invitaciones/`, `motor/relayEngine.ts`.

**Hacia `contact-keys` (spec §7.3/§7.5).** Es el candidato más grande a
segundo paquete `@hushsplit/contact-keys` (identidad + canal QR + pineo +
entrega de claves): `contactTopic`/`groupKeyWrap` migran chico, `contactChannel`
es **medio-grande** porque mezcla canal + tarjeta con perfil de HushSplit +
adopción de ofertas — hay que partirlo primero (puerto Perfil).
**Hallazgo §7.4** (la tarjeta de `contactChannel.ts` no va firmada; un
`userId` ajeno se puede ocupar de antemano) queda **T-207 (en pausa, decisión
del PO)** — la corrección es firmar la tarjeta y autocertificar el `userId`.

Leer: ADR-013, ADR-015, T-096, T-136. Tests: `contactos/__tests__`.
