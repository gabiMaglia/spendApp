# T-096 — Links de un solo uso (invitación a grupo y link de contacto)

- **Fecha:** 2026-09-15
- **Ticket:** T-096 · SEC M-3 (auditoría de seguridad, links como llave al portador).
- **Nivel:** Strong.
- **Obligatorio:** antes del lanzamiento público.
- **Arquitectura:** ADR-015 (`engram/02_architecture.md`), aceptada por el PO 2026-09-15: links de un solo uso, regla general para todo link que emite la app.
- **Decisiones del PO (2026-09-15):** un uso = una persona en la invitación a grupo (no "un uso por destinatario, mismo link reusable entre varios"); QR de contacto en persona queda sin cambios, sólo el botón "Compartir" pasa por token efímero; se acepta el costo de que el alta por link deje de ser instantánea; se suma en este mismo spec mostrar la huella del invitador en `join.tsx`.

## 1. Problema

Dos mecanismos de link comparten el mismo defecto: son **llave al portador**, sin ningún estado del lado del servidor que limite cuántas veces o quién los usa.

**Invitación a grupo** (`src/sync/groupInvite.ts`, `src/sync/inviteEngine.ts`): el link es válido 48hs y, a propósito ("Con un link abierto entran varios; cada uno tiene el suyo" — `inviteEngine.ts:182`), admite a **cualquier cantidad de personas distintas** que lo abran dentro de la ventana. Un reenvío accidental por mail —o un hilo de Gmail/Outlook que precarga el link— le da a un tercero el historial completo del grupo, sin que el invitador se entere. `app/groups/join.tsx` tampoco muestra la huella (`inviterFingerprint`) que ya viaja en el link, así que quien acepta no tiene forma de verificar de quién vino.

**Link de contacto** (`src/utils/contactLink.ts`): el botón "Compartir" de `app/contact/add.tsx` arma un link con el `contactSecret` **permanente** de la cuenta embebido directo (el mismo secreto que también lleva el QR de pantalla). Quien lo abre y confirma queda agregado como contacto mutuo **en el acto** — sin ningún round-trip — porque el link ya trae todo lo necesario. Reenviado por mail, cualquiera que lo abra se vuelve un contacto pinneado indistinguible del destinatario real, con acceso a lo que ese canal permite (tarjeta, futuras claves de grupo por T-136).

El QR de contacto mostrado en pantalla comparte el mismo secreto, pero su modelo de confianza es distinto: se asume presencia física de quien escanea (`contactChannel.ts:50-52`), no reenvío por canal. Ese caso no es el que ataca SEC M-3 y queda fuera de alcance de este cambio.

## 2. Objetivo y no-objetivos

**Objetivos:**
- Un link de invitación a grupo lo puede canjear **una sola persona**; un segundo destinatario que lo abre después no entra.
- Un link de contacto compartido por "Compartir" (mail/chat) lo puede canjear **una sola persona**; el secreto permanente de la cuenta nunca viaja directo en ese link.
- `join.tsx` muestra la huella del invitador antes de aceptar.

**No-objetivos:**
- No se toca el modelo "abierto" de quién puede generar una invitación (sigue siendo cualquier miembro del grupo).
- No se cambia el TTL de 48hs de ningún link.
- No se rediseña el QR de contacto en pantalla (secreto permanente, alta instantánea, sin cambios).
- No se agrega un paso de confirmación del lado de quien comparte el link (el primer reclamo válido se admite automático, como ya pasa hoy en la invitación a grupo).
- No se resuelve el residual de ADR-013 (grupo sin creador firmado) ni compite con él.

## 3. Diseño

### 3.1 Invitación a grupo — un solo uso

`GroupInvite` (tipo en `src/sync/groupInvite.ts`) suma un campo opcional:

```typescript
export type GroupInvite = {
  groupId: string;
  groupName: string;
  token: string;
  inviterFingerprint: string;
  expiresAt: number;
  /** Quién ya canjeó esta invitación. Sólo en la copia persistida del invitador — nunca viaja en el link. */
  claimedBy?: string;
};
```

`claimedBy` **no** se codifica en el link (ni en el formato largo de `inviteToLink`, ni en el compacto de `linkCompacto.ts` §invitación) — es estado local del dispositivo que invita, persistido junto al resto del registro en `identityStore` (`saveInvite`, `K_INVITES`).

**`inviteEngine.ts::admit()`** cambia su guarda de entrada:

```typescript
async function admit(claim, invite, topic, deviceId, myUserId) {
  if (claim.groupId !== invite.groupId || claim.userId === myUserId) return;

  // Un solo uso: el primer reclamo válido consume la invitación para cualquier
  // otra persona. El MISMO reclamante puede seguir reintentando (la entrega
  // se pudo haber perdido) — eso es lo que ya hace resiliente el reintento
  // actual. Se relee el registro persistido, no el parámetro `invite`, porque
  // dentro del mismo lote puede haberlo actualizado una iteración anterior.
  const actual = findInviteToken(invite.groupId, invite.token);
  if (actual?.claimedBy && actual.claimedBy !== claim.userId) return;

  // ... resto sin cambios (agregar al roster, publicar estado, envolver clave) ...

  if (!actual?.claimedBy) markInviteClaimed(invite.groupId, invite.token, claim.userId);

  // ... sellar y mandar la entrega, sin cambios ...
}
```

`markInviteClaimed(groupId, token, userId)` es una función nueva en `src/store/identityStore.ts`, al lado de `saveInvite`/`findInviteToken`: relee el registro por `(groupId, token)`, le fija `claimedBy` y lo vuelve a persistir con `saveInvite`.

**Qué ve un segundo destinatario:** su reclamo se sigue publicando (no hay forma de que sepa de antemano que el link ya fue usado — el buzón es un mailbox tonto, sin ACL). Simplemente nunca recibe una entrega. Su invitación pendiente (`K_PENDING`) expira sola a las 48hs, igual que cualquier invitación que nunca se completó por otra razón (el invitador offline todo ese tiempo, por ejemplo) — mismo camino de falla existente, sin agregar un tipo de mensaje "denegado" nuevo. Se documenta como decisión explícita en el criterio de aceptación §4.2.

### 3.2 Link de contacto ("Compartir") — token efímero

Módulo nuevo, **`src/sync/contactInvite.ts`**, con la misma forma que `groupInvite.ts` pero para el par de tarjetas de contacto en vez de la clave de grupo:

```typescript
export type ContactInvite = {
  /** Quien comparte: para mostrar "vas a agregar a X" antes de cualquier red. */
  fromUserId: string;
  fromName: string;
  token: string;
  inviterFingerprint: string;      // fingerprint(identityPublicKey de quien comparte)
  expiresAt: number;               // now + 48h, misma constante que INVITE_TTL_MS
  claimedBy?: string;               // sólo en la copia persistida de quien comparte
};
```

Reutiliza de `groupInvite.ts`: `fingerprint()`, `sealEnvelope`/`openEnvelope` (vía `envelopeCrypto`), el patrón `CLAIM_DOMAIN`/`TOPIC_DOMAIN` (dominios separados nuevos: `splitp2p/contact-invite/v1` y `.../v1/topic`, para no colisionar con los de invitación a grupo ni con los del canal de contacto ya establecido).

**Funciones:**
- `createContactInvite(me, deviceId): ContactInvite` — arma el registro con token al azar (`Crypto.getRandomBytes(32)`) y lo persiste (nuevo store, `K_CONTACT_INVITES`, mismo patrón que `K_INVITES`).
- `contactInviteToLink(invite): string` — arma el link. Formato compacto nuevo, letra `i` (ver §3.4), o el largo vía `enlaceCompartible('contact/claim', params)` si no calza.
- `parseContactInviteLink(link): ContactInvite | null` — inverso, valida formas igual que `inviteFromParams`.
- `sealContactClaim` / `openContactClaim` / `sealContactGrant` / `openContactGrant` — mismos roles que sus equivalentes de `groupInvite.ts`, pero el `claim` y el `grant` llevan una `ContactCard` completa (tipo ya existente en `contactChannel.ts`) en vez de una clave de grupo envuelta. El `grant` va firmado con la Ed25519 de quien lo manda y se verifica contra `inviterFingerprint`, igual que `openGrant`.

**Motor, `src/sync/contactInviteEngine.ts`** (mirror de `inviteEngine.ts`):
- `publishContactClaim(invite, deviceId): Promise<boolean>` — llamado cuando alguien toca «Agregar» sobre un link de contacto recibido. Arma su propia `ContactCard` (`myContactCard()`, sin cambios) y la publica sellada con la clave derivada del token, en el topic derivado del token (no en el buzón permanente de nadie).
- `processContactInvites(deviceId): Promise<string[]>` — llamado en cada tick de sync (`relayEngine.ts`, al lado de donde hoy se llama `processAllInvites`), para **cada `ContactInvite` que yo generé** que siga sin `claimedBy`: lee el buzón efímero, abre el primer reclamo válido, guarda a esa persona como peer (`savePeerFromCard`, función ya existente) y contesta con mi `ContactCard` real sellada como `grant`. Marca `claimedBy` en el registro persistido antes de mandar el grant (mismo orden que T-136 enseñó a respetar: primero el estado que cierra la puerta, después el efecto de red). Un segundo reclamo de otra persona, sobre el mismo token, se ignora — misma guarda que §3.1.
- Del lado de quien reclamó: sigue drenando su propia bandeja de invitaciones de contacto pendientes (mismo mecanismo que `listPendingJoins`, nuevo `listPendingContactClaims`) hasta ver el `grant` o hasta que expire a las 48hs. Al abrir el grant, llama a `savePeerFromCard` con MI `ContactCard`, completando el alta mutua.

**Costo aceptado (documentado en el diseño, no un defecto):** con este cambio, tocar «Agregar» sobre un link de contacto deja de ser instantáneo — antes guardaba el contacto mutuo en el mismo instante porque el link ya traía el secreto real; ahora depende de que quien compartió el link sincronice al menos una vez (`processContactInvites`) para que la entrega llegue. Es el mismo costo que ya tiene hoy la invitación a grupo, y es inevitable: es la única forma de que el secreto permanente no quede regalado a cualquiera que reenvíe el link.

### 3.3 QR de contacto — sin cambios

`myQRData` (`app/contact/add.tsx`, vía `buildContactPayload`) sigue llevando el `contactSecret` permanente de la cuenta, tal cual hoy. El alta del que escanea (`persistirContacto`, `procesarContacto` con `origen: 'qr'`) no cambia. Sólo `deepLink` (vía `buildContactDeepLink`, botón "Compartir") pasa a construirse con `contactInviteToLink(createContactInvite(...))` en vez de `buildContactDeepLink(currentUser, misClaves)`.

El flujo de `origen: 'link'` en `procesarContacto`/`persistirContacto` deja de recibir un `ContactPayload` completo (con `secret` real) al parsear el link: pasa a recibir un `ContactInvite` (con `token`, sin secreto), y la persistencia real del contacto (`savePeer` + `announceContact`) se mueve al momento en que llega el `grant` (procesado en background, no en la pantalla). La pantalla, al tocar «Agregar» sobre un link, pasa a: publicar el reclamo (`publishContactClaim`) y mostrar un estado "pendiente, esperando confirmación" en vez del alta inmediata — mismo texto/patrón que ya usa la invitación a grupo pendiente hoy en la lista de contactos/grupos.

### 3.4 Formato compacto del link de contacto por invitación

Nueva entrada en `src/utils/linkCompacto.ts`, letra de tipo `i` (invitación de contacto; no colisiona con `c` contacto directo ni `g` invitación a grupo):

| bytes | contenido |
|---|---|
| 1 | versión = `1` |
| 1 | flags. bits 0-1: forma del id de quien invita (`0` texto, `1` UUID, `2` número) |
| id | igual que en `c` |
| 32 | token |
| 16 | huella de quien invita |
| 6 | vencimiento en milisegundos, entero sin signo big-endian |
| resto | nombre de quien invita, UTF-8 (no vacío) |

Misma estructura que la tabla de invitación a grupo (§ya documentada en `linkCompacto.ts`), sin el `groupId`/nombre de grupo. `codificarInvitacionDeContacto`/`decodificarInvitacionDeContacto`, mismas garantías de ida y vuelta exacta que las otras dos.

### 3.5 Huella del invitador en `join.tsx`

`app/groups/join.tsx` ya recibe el `GroupInvite` parseado (con `inviterFingerprint`) pero nunca lo muestra. Se agrega, antes del botón de aceptar, un texto con la huella corta —mismo formato que ya usa `shortFingerprint` en `app/contact/add.tsx`— con la traducción `groups.join.inviter_fingerprint` ("Invitación de alguien con huella ‹fingerprint›"). No se agrega ninguna verificación nueva, sólo visibilidad: el usuario sigue sin forma de confirmar la huella contra nada (igual que hoy con nombres "no verificados" de ADR-012/013), pero al menos la información que ya viaja deja de estar oculta.

## 4. Criterios de aceptación y tests

1. **Invitación a grupo, un solo uso:**
   - Beto reclama primero un link → se admite, se persiste `claimedBy = beto.id`, recibe la entrega.
   - Mallory reclama el mismo link después → no se admite, no hay entrega, no entra al roster. Test directo sobre `admit()`/`processInvite` con dos claims en el mismo lote y en lotes separados (mismo patrón que T-136 §4.1-4.2).
   - Beto reintenta el reclamo (simulando entrega perdida) después de haber sido admitido → sigue recibiendo la entrega (no rompe el reintento existente).
   - `findInviteToken`/`markInviteClaimed`: tests directos de round-trip sobre `identityStore`.
2. **Sin aviso explícito de "ya usado":** el segundo reclamo de Mallory no genera ningún mensaje nuevo en el buzón; su `pendingJoin` sigue existiendo hasta que expira a las 48hs (test de `isInviteExpired` sin cambios).
3. **Link de contacto, token efímero:**
   - `createContactInvite`/`contactInviteToLink`/`parseContactInviteLink`: round-trip, con y sin formato compacto.
   - `publishContactClaim` + `processContactInvites`: reclamo válido → primer reclamante recibe grant, queda guardado como peer con `savePeerFromCard`, `claimedBy` persiste.
   - Segundo reclamante sobre el mismo token → no recibe grant, no se guarda.
   - El link de contacto NUNCA contiene el `contactSecret` permanente de la cuenta (test que decodifica el link y verifica que no hay ningún campo de 64 hex chars que matchee el secreto real).
4. **QR de contacto sin cambios:** los tests existentes de `contactLink.test.ts`/`contactChannel.test.ts` para el flujo `origen: 'qr'` siguen verdes sin modificación.
5. **Formato compacto:** `codificarInvitacionDeContacto`/`decodificarInvitacionDeContacto` — ida y vuelta para las tres formas de id, con y sin nombre largo, y rechazo de largo/versión inválidos (mismas garantías que `c` y `g`).
6. **`join.tsx`:** renderiza la huella cuando el invite la trae; no rompe cuando `inviterFingerprint` viene vacío (invitaciones viejas, formato largo sin ese parámetro).
7. `npx jest`, `npx tsc --noEmit` y `npm run lint` (base 124 warnings / 0 errores, `main`@`2c761b5` — reverificar contra el estado real de `main` al momento de implementar, que puede haber avanzado) sin regresiones.

## 5. Verificación en aparato (PO)

Con dos teléfonos o cuentas A y B:
1. A genera un link de invitación a grupo y lo manda por WhatsApp a B y, reenviado, a un tercer dispositivo M.
2. B lo abre primero y entra. M lo abre después y no entra (ni ve el grupo, ni recibe nada — su pantalla se queda "esperando" hasta que decide salir).
3. A comparte su link de contacto (botón "Compartir") con B. B lo abre y toca «Agregar»: ve un estado pendiente, no el alta inmediata. Cuando A abre la app (dispara sync), B pasa a contacto mutuo.
4. El QR de A (pantalla "mi código") sigue agregando a quien lo escanea en el acto, sin cambios.

Si armar el reenvío a un tercer dispositivo en aparato no es práctico, este criterio se cubre con los tests de integración de §4.1 y se declara así en el handoff.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| El alta por link de contacto deja de ser instantánea | Aceptado por el PO (2026-09-15); mismo costo que ya tiene la invitación a grupo hoy |
| Un segundo destinatario legítimo (no atacante) que necesitaba el mismo link no puede usarlo — ej. se lo reenvían a dos personas de la familia sin querer | Decisión de negocio explícita del PO: un uso = una persona; quien invita genera un link nuevo por persona |
| Nuevo formato compacto (`i`) mal implementado deja el link de contacto compartido más largo de lo necesario | Mismas garantías de ida-y-vuelta exacta que `c`/`g`; cae al formato largo si no calza, como ya hacen los otros dos |
| `claimedBy` persistido mal (ej. no sobrevive un restart) reabre el problema de multi-uso | Test de round-trip sobre `identityStore` explícito en §4.1, y el mismo patrón de `saveInvite` que ya está probado |
