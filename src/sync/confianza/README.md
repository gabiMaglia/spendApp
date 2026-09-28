# confianza — quién escribió cada registro
Firma por REGISTRO (T-041) y medición en modo aviso (R1: ver, no bloquear).
- `recordCore`: qué campos se firman · `recordSign`: firmar/verificar.
- `signOnWrite`: firmar al escribir en los stores · `devicePrivateKey`.
- `verdictCache`, `ratchet`, `recordHealth(+Store)`: medir sin re-verificar.
- `authorKeys*`: públicas por autor (caché, resolución, refresco).
- `deviceKeys`: directorio de claves por cuenta (ADR-004).
- `authorHealth`: autoría del SOBRE (fase B, aviso).
- `trustCheck`, `autoriaTrust`, `derivedRecords`: veredicto para la UI.
- `leaveApproval*`: aprobación firmada de salida de un grupo (T-065).
Producto: depende del modelo de gastos (`types/models`). No va al paquete.
Depende de: `store/*` (authStore, groupKeyStore, identityStore, lww), `nucleo/hexBytes`, `sesion/directoryAuth`, `invitaciones/groupInvite`. Lo usan: `algorithms/`, `hooks/useRecordTrust`, `store/*` (comment/expense/group/payment/recurring), `motor/`, `sesion/`.

**Hacia `contact-keys` (spec §7.3/§7.5).** `deviceKeys.ts` es candidato a
adaptador opcional (puerto `Directorio`) del futuro paquete `@hushsplit/contact-keys`;
el resto de esta carpeta (firma por registro, T-041) es producto y no migra.
El hallazgo de suplantación de identidad por tarjeta sin firmar (spec §7.4,
en `contactos/contactChannel.ts`, no en esta carpeta) queda **T-207 (en pausa,
decisión del PO)**; si se corrige, la firma de la tarjeta usaría las mismas
claves Ed25519 que ya gestiona `deviceKeys.ts`/`authorKeys.ts` acá.

Leer: ADR-004, T-041, T-170. Tests: `confianza/__tests__`.
