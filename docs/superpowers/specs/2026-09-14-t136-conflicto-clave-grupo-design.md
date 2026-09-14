# T-136 — Clave de grupo por contacto: ofertas y elección ante conflicto

- **Fecha:** 2026-09-14
- **Ticket:** T-136 · residual de T-132 (SEC3 S3-A1).
- **Nivel:** Strong, con verificador ciego y pruebas de mutación.
- **Obligatorio:** antes del lanzamiento público.
- **Arquitectura:** ADR-013 (`engram/02_architecture.md`) · plan detallado del arquitecto: `engram/plans/T-136.md`. Ese plan sigue siendo la referencia de citas `archivo:línea` y del orden de pasos.
- **Decisiones del PO (2026-09-14):** ratifica la opción (e) de ADR-013 y aprueba los textos de §3.2.

## 1. Problema

`adoptDroppedKey` (`src/sync/contactChannel.ts`) adopta la primera clave firmada por un peer para un grupo que todavía no tenemos, sin atar remitente y grupo.

«Peer» es cualquiera que conozca mi secreto de contacto: la tarjeta que manda al escanear mi QR lo pinnea. La primera clave bloquea para siempre tres cosas:
- la entrega por contacto;
- la invitación, que `inviteEngine.redeem` cierra en silencio;
- el QR, si la clave plantada trae una época absurda.

Además, la víctima escribe en el topic del atacante, que lee lo nuevo que ella carga.

La membresía no sirve para arbitrar. El roster viaja cifrado con la clave en disputa, `memberIds` no está firmado y la autoría es sólo un aviso. Todo dato del topic lo puede fabricar el atacante.

## 2. Objetivo y no-objetivos

**Objetivos:**
- Una clave de contacto nunca gana sola si otro remitente entrega una distinta.
- El usuario elige ante un conflicto real, y sólo entonces se lo molesta.
- El caso normal (un remitente, o varios con la misma clave) no cambia.

**No-objetivos (residual de ADR-013):**
- Atar el `groupId` a su creador con firma (cambio de protocolo).
- Proteger contra un usuario engañado que elige la clave del atacante (ingeniería social; el texto lo mitiga).
- Tocar `src/sync/groupInvite.ts` (T-129 v2).

## 3. Diseño

### 3.1 Mecanismo

**Ofertas — `src/sync/groupKeyOffers.ts` (nuevo)**
- `KeyOffer = { groupId, fromUserId, key, epoch, origen: 'contact' | 'invite', receivedAt, adoptada: boolean }`.
- Almacenamiento cifrado y scopeado por cuenta (`createSecureStorage` + `readScoped`/`writeScoped`, como `groupKeyStore`). Entra al guard de cobertura de cuenta.
- Lógica pura, testeable sin MMKV:
  - `registrarOferta(o)`: dedupe por (groupId, fromUserId). Misma clave → no-op. Clave distinta del mismo remitente → reemplaza su oferta. Tope `MAX_OFERTAS_POR_GRUPO = 5`: un sexto remitente nuevo se ignora.
  - `ofertasDe(groupId)`.
  - `estado(groupId, claveLocal?)` → `'sin_ofertas' | 'unanime' | 'conflicto'`.
  - `marcarAdoptada(groupId, fromUserId)`.
  - `olvidarOfertas(groupId)`.
  - `claveLocalVinoDeContacto(groupId)`: `true` si hay una oferta `adoptada` cuya `key` es la local.

**Canal de contacto — `src/sync/contactChannel.ts`**
- `adoptDroppedKey` conserva la verificación de destinatario y firma, y el unwrap con validación de largo. El unwrap pasa antes de la guarda «ya la teníamos».
- Si hay clave local:
  - igual a la entregada → no-op;
  - distinta y `claveLocalVinoDeContacto` → registra la oferta y marca conflicto;
  - distinta en cualquier otro caso → se ignora sin registrar nada. S3-A1 sigue cerrado: las claves de `ensureKey`, QR o invitación nunca son elegibles.
- Si no hay clave local → registra la oferta.
- `adoptDroppedKey` ya no adopta dentro del loop. Al final del lote, `drainContacts` resuelve por grupo:
  - `unanime` → `adoptKeys` + `marcarAdoptada` y el grupo va a `joinedGroups`;
  - `conflicto` → el grupo va a un campo nuevo `conflictedGroups: string[]` de `DrainContactsResult`.
- `src/sync/relayEngine.ts`: por cada grupo de `conflictedGroups`, `announce({ kind: 'group_key_conflict', groupId, groupName, senderIds })`. `groupName` sale del grupo local si existe; si no, del drop. Se muestra **siempre** con la marca «sin verificar» (PO, 2026-09-14): un grupo local en conflicto pudo drenarse con la clave en disputa.

**Invitación — `src/sync/inviteEngine.ts` (`redeem`)**
- Si ya hay clave local, se hace el unwrap del grant.
- Distinta y `claveLocalVinoDeContacto` → `registrarOferta({ origen: 'invite' })`, anuncia el conflicto y `removePendingJoin`.
- En cualquier otro caso, como hoy.

**Elección — `src/services/elegirClaveDeGrupo.ts` (nuevo)**
- Firma: `elegirClaveDeGrupo(groupId: string, fromUserId: string): Promise<boolean>`.
- Pasos, en orden:
  1. Guardas: hay oferta de ese remitente, y la clave local, si existe, vino de contacto. Si no se cumplen → `false` sin efectos.
  2. `purgarGrupoLocalmente(groupId)` (`src/services/salirDelGrupo.ts`), que incluye `forgetKey`.
  3. `adoptKeys([{ groupId, key, epoch }])`, que deja el grupo pendiente de drenaje.
  4. `marcarAdoptada` y descartar las demás ofertas del grupo.
  5. `drainNow(groupId)` con `require` perezoso.
- No llama a `salirDelGrupo`, así que no publica nada en el topic falso.
- `purgarGrupoLocalmente` también llama a `olvidarOfertas(groupId)`.

**Regla de `groupKeyStore`:** el comentario «una clave nunca se pisa» pasa a «nunca automáticamente; sólo por elección del usuario, sobre una clave que vino de contacto, y previa purga (ADR-013)».

### 3.2 Interfaz

**`Notice`** (`src/services/syncNotices.ts`): `{ kind: 'group_key_conflict'; groupId: string; groupName: string; senderIds: string[] }`. Se registra en `src/services/notifications.ts` en la categoría existente de invitaciones, sin push nuevo. En la bandeja (`noticeInboxStore`) es un aviso **que pide acción**.

**Aviso en la campana**
- Título: «Dos personas te mandaron claves distintas para "‹grupo›"». Con más de dos remitentes: «Recibiste claves distintas para "‹grupo›"».
- Cuerpo: «Sólo una es la real. Elegí la de alguien que sepas que está en el grupo. El nombre es el que tenés guardado del contacto; la app no puede verificar quién es.»
- El nombre del grupo se muestra siempre como «‹grupo› (nombre sin verificar)».

**Tarjeta — `src/components/GroupKeyConflictCard.tsx` (nuevo)**
- Dentro de `ButtonRack`, un `ActionButton` por remitente, con nombre y avatar del contacto: «Usar la clave de ‹nombre›».
- «Decidir después»: cierra la tarjeta y el aviso sigue pendiente.

**Confirmación** (`Alert`), al tocar un remitente:
- Título: «¿Usar la clave de ‹nombre›?»
- Cuerpo: «Se borra lo que tenés de "‹grupo›" en este teléfono y se vuelve a bajar con esa clave. Lo que hayas cargado desde que llegó la otra clave se pierde.»
- Botones: «Cancelar» / «Usar esta clave» (destructivo).

**Mientras no se elige:** no se adoptó ninguna clave, así que el grupo no aparece y el aviso queda en la bandeja.

**i18n:** claves `sync.keyConflict.*` en `src/i18n/locales/es.json` (fuente), `en.json` y `pt.json`. Ningún string en JSX.

## 4. Criterios de aceptación y tests

1. **Ataque en dos lotes** (rojo en `main`): Mallory, peer pinneado por tarjeta y no miembro, manda una clave K' válida para el grupo G con `epoch: 1e9`. Después Beto, miembro, manda K para G.
   - La clave local sigue siendo K', sin sustitución automática.
   - Hay un solo aviso `group_key_conflict` para G, con los dos remitentes.
   - G no está en `joinedGroups` del segundo drenaje.
   - Tras `elegirClaveDeGrupo(G, BETO.id)`: la clave local es K con la época de Beto, los stores no tienen nada de G anterior a la elección y G queda pendiente de drenaje.
2. **Mismo lote:** los drops de Mallory y Beto con claves distintas en un mismo drenaje → no se adopta ninguna, hay aviso de conflicto y G no está en `joinedGroups`.
3. **Caso feliz:**
   - Un drop, o dos remitentes con la misma clave, adoptan y devuelven G en `joinedGroups`.
   - Reenviar la misma clave del mismo remitente N veces no crea ofertas ni avisos.
   - Todos los tests actuales de `contactChannel.test.ts` siguen verdes.
4. **S3-A1:** si la clave local vino de `ensureKey`, QR o invitación, un drop con otra clave no genera oferta ni aviso, y `elegirClaveDeGrupo` devuelve `false` sin efectos. Lo mismo con un remitente sin oferta.
5. **Invitación:** con K' plantada por contacto, `redeem` de un grant con K registra la oferta (`origen: 'invite'`) y levanta el conflicto, en vez de cerrar en silencio. Con la misma clave, igual que hoy.
6. **Topes:** 5 remitentes por grupo (el sexto se ignora); un remitente reemplaza sólo su oferta; como máximo un aviso de conflicto sin leer por grupo.
7. **Almacenamiento:** ofertas cifradas y scopeadas; entran al guard de cobertura de cuenta; se borran al elegir y al `purgarGrupoLocalmente`.
8. **Mutaciones:** cada una debe tirar al menos un test.
   - M1: adoptar la primera clave sin mirar conflictos.
   - M2: `elegirClaveDeGrupo` sin purga.
   - M3: permitir elegir cuando la clave local no vino de contacto.
   - M4: sacar la dedupe por (grupo, remitente, clave).
9. **UI:** `GroupKeyConflictCard` renderiza un botón por remitente. Tocar uno y confirmar llama a `elegirClaveDeGrupo(groupId, userId)`; cancelar no llama. «Decidir después» no marca el aviso como resuelto. Las claves i18n existen en es, en y pt.
10. `npx jest`, `npx tsc --noEmit` y `npm run lint` (base 127 warnings / 0 errores) sin regresiones.

## 5. Verificación en aparato (PO)

Con tres teléfonos o cuentas A, B y M:
1. M escanea el QR de A.
2. B crea un grupo con A como contacto.
3. Antes de que A reciba la clave de B, M manda una clave falsa para ese grupo. Esto requiere un build de prueba o un script de QA con el `groupId`.
4. A ve el aviso con M y B, elige B y confirma. El grupo aparece con los datos reales de B.

Si armar el paso 3 en aparato no es práctico, este criterio se cubre con los tests de integración de §4.1–4.2 y se declara así en el handoff.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Usuario engañado elige al atacante | Texto «la app no puede verificar quién es»; cierre de fondo (atar el grupo a su creador) anotado en ADR-013 |
| Se pierde lo cargado entre la clave falsa y la elección | Advertido en la confirmación; aceptado por el PO |
| Mover el unwrap antes de la guarda cambia el orden de validaciones | Firma y destinatario se siguen verificando antes; tests existentes de `contactChannel` como red |
| Aviso repetido por reenvíos en cada arranque | Dedupe de ofertas y tope de un aviso sin leer por grupo (§4.6) |
