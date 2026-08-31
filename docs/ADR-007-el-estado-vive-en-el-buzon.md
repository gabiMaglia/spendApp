# ADR-007 · El estado completo vive en el BUZÓN, no en cada sobre

**Estado:** PROPUESTO — pendiente de decisión del PO
**Enmienda a:** ADR-003 (`engram/02_architecture.md`), decisión 1 (buzón store-and-forward) y su invariante §3
**Origen:** T-058 · medición de T-056 (`engram/plans/T-056.md`) · fallo reproducido en producción
**Exige migración de Supabase aplicada a mano por el PO — ver §6**

---

## 1 · Contexto: el número, con la cuenta hecha

`sendEnvelope` compara `byteLength(payload)` contra `MAX_PAYLOAD_BYTES = 262_144`
(`src/sync/relay.ts:52`, `src/sync/relay.ts:123`). Lo que se le pasa como `payload` **no es el
JSON del delta**: es `firmado`, la salida de `signEnvelope` (`src/sync/relaySync.ts:99,103`).

```
firmado = {"v":1,"p":"<base64>","k":"<64 hex>","s":"<128 hex>"}      envelopeSign.ts:35-54
p       = base64( nonce(24B) ‖ ciphertext ‖ tag(16B) )              envelopeCrypto.ts:53-62
```

Con `J` = bytes del JSON del delta:

| término | bytes |
|---|---|
| esqueleto del wrapper `{"v":1,"p":"","k":"","s":""}` | 28 |
| `k` (pública Ed25519 en hex) | 64 |
| `s` (firma en hex) | 128 |
| `p` = `4·ceil((J + 40)/3)` | ×4/3 sobre el JSON |

```
220 + 4·(J + 40)/3  ≤  262 144
                 J  ≤  196 403 bytes
```

> **El presupuesto real de datos son 196.403 bytes de JSON — el 74,9 % del número nominal.**
> El ×4/3 del base64 pasa ANTES de la comparación. Está anotado en `relay.ts:27-51`; acá queda
> la aritmética exacta.

### Lo que eso significa en gastos

De los dos puntos medidos con arné real en T-056 (5 miembros, 30 y 200 gastos: 66.824 y
239.439 bytes de JSON), la pendiente es **~1.015 bytes por gasto** a 5 miembros — y crece con
la cantidad de miembros, porque `splits` lleva un renglón por participante (el escenario C, 8
miembros, sube a ~1.100 B/gasto). Con las fotos de los 5 miembros ocupando 33.460 bytes fijos:

> **Un grupo de 5 personas topea alrededor de los 160 gastos. Sin ninguna foto, alrededor de
> los 190.** No es un techo lejano: son seis meses de uso normal.

Y el techo no es un tope de crecimiento: es un **acantilado**. Cruzarlo no degrada nada,
apaga el grupo — `publishToGroup` devuelve `too_large` (`relaySync.ts:103-104`) y ese grupo no
publica nunca más. T-041 sigue agregando `k`/`s`/`rev` por registro, así que la pendiente sube.

### El costo por edición, que es el otro problema

Cada publicación manda el estado completo. Agregar **un** gasto de ~1 KB en el escenario B
sube **319.528 bytes** al buzón. En el escenario F de T-056, de los 47.840 bytes que cuesta
agregar un gasto a un grupo joven, **33.460 (94 %) son fotos que nadie tocó**.

*(Corrección a un supuesto que era fácil de dar por bueno: recibir un delta **no** dispara una
republicación. `mergeExpenses` no llama a `schedulePublish` — sólo lo hacen los caminos de
escritura local, `expenseStore.ts:46,59`. El costo es 1× por edición, no M×.)*

---

## 2 · Por qué la solución obvia está prohibida

Filtrar por fecha (regla #8 de `CLAUDE.md`) rompe tres mecanismos que dependen de que **cada
sobre se baste a sí mismo**:

1. `supabase/004_compaction.sql:10-14` — compactar es seguro **sólo** porque los sobres llevan
   estado; con algo incremental pasa a ser «pérdida de datos silenciosa».
2. `supabase/001_mailbox.sql:36-40` + `engram/02_architecture.md:542` — el TTL de 30 días es
   seguro por la misma razón.
3. `src/sync/envelopeSign.ts:65-66` — descartar un sobre sin firma «cuesta nulo» porque el
   siguiente lo reemplaza.

Y P-2 (`engram/02_architecture.md:659`, decisión del PO): el que entra ve **todo** el historial
sin recibir claves viejas, justamente porque un miembro le publica el estado completo sellado
con `GK_N`.

**La regla #8 describe una arquitectura que el proyecto descartó a conciencia.** Este ADR no la
resucita.

---

## 3 · Decisión

> **El invariante se re-escala, no se abandona.**
>
> - **Hoy (R):** *cada sobre, solo, es un estado completo del grupo.*
> - **Desde acá (R′):** *el conjunto de sobres que el servidor retiene para un topic es, en
>   todo momento, un estado completo del grupo — y cada sobre, solo, es un estado completo
>   de la PORCIÓN que declara cubrir.*

R′ es estrictamente más débil que R, y es todo lo que los cuatro mecanismos necesitan: ninguno
pide "estado completo del grupo", todos piden "**estado, no operaciones**". Una porción sigue
siendo estado. Nunca viaja un "sumale 500".

### 3.1 · Rebanadas (*slices*)

Cada dispositivo parte SU copia del estado del grupo en **rebanadas** disjuntas y publica una
rebanada por sobre. Una rebanada es un `SyncDelta` normal con un subconjunto de registros.

- **La partición es una decisión LOCAL del que publica.** La compactación se mantiene por
  `(topic, sender, …)`, así que ningún dispositivo tiene que coincidir con otro en cómo parte
  su copia. Cero coordinación, cero elección de líder.
- **Primero por tipo de entidad, después por prefijo de `id`.** Que `users` (las fotos, 33 KB
  fijos) tenga su propia rebanada es lo que hace que agregar un gasto deje de arrastrar las
  fotos de todos: es el hallazgo F de T-056, resuelto de costado.
- **La profundidad del prefijo la elige el emisor por tamaño**, no por una constante: se
  parte hasta que cada rebanada quede debajo del objetivo. Objetivo propuesto **~24 KB de
  JSON**, tope duro **96 KB** (la mitad del presupuesto), para que una rebanada pueda crecer
  entre repartos sin acercarse jamás al acantilado.

### 3.2 · El objetivo de tamaño es un canje medible, y hay que medirlo

| rebanada más chica | tráfico por edición | costo del que entra |
|---|---|---|
| ↓ | ↓ | ↑ (más sobres ⇒ más verificaciones) |

El límite superior de "más rebanadas" lo pone un número medido en el device del PO:
**`ed25519.verify` = 37,57 ms/op** (`engram/plans/T-041.md:1067`). `drainGroup` verifica la
firma de **cada** sobre (`relaySync.ts:140-142`).

| diseño | sobres que verifica el que entra (5 miembros) | hilo JS bloqueado |
|---|---|---|
| hoy | 5 | ~0,19 s |
| rebanadas, K=10 | 50 | ~1,9 s |
| **un sobre por registro (200 gastos)** | **1.000** | **~37,6 s** ⇒ **inviable** |

> **Un sobre por registro queda DESCARTADO por este número**, no por elegancia. La granularidad
> tiene un piso duro puesto por la curva.

### 3.3 · El manifiesto — lo que impide que "incompleto" sea silencioso

Cada emisor publica además un **manifiesto**: un sobre chico con la lista de las `ckey` que
dice cubrir y el digest de cada rebanada.

Sin él, R′ tiene un modo de falla **peor que el de hoy**: un buzón al que le falta una
rebanada se ve exactamente igual que uno completo, y el que entra calcula balances con la
mitad de los gastos y los muestra como definitivos. Hoy un grupo roto no muestra nada — es
ruidoso. Un historial parcial es silencioso, y acá se corrompe plata.

Con el manifiesto, "me faltan rebanadas de este emisor" es **detectable** y se puede avisar
igual que `useSyncFailure` avisa `too_large` hoy.

El manifiesto viaja con `version` **distinta de 1** a propósito: `applyDelta` descarta todo
delta con `version !== 1` (`useSyncQR.ts:123`), así que un lector viejo lo **ignora** en vez de
mergear basura. El guard que ya existe nos regala el "ignorar sobres de tipo desconocido".

### 3.4 · La renovación — lo que salva al TTL

Es el único mecanismo de los cuatro que R′ **rompe de verdad**: hoy cada publicación reescribe
el estado entero, así que `expires_at` se refresca todo el tiempo. Bajo R′, una rebanada que
nadie toca durante 30 días **expira y desaparece del buzón**, y el estado deja de estar completo.

> **Obligación nueva del cliente:** republicar toda rebanada cuya última publicación sea más
> vieja que un margen de seguridad (propuesto: 20 días). Cuesta O(rebanadas), no O(bytes).

Requiere un registro local `ckey → cuándo la publiqué` (MMKV). Perderlo (reinstalación) sólo
provoca una republicación completa, que es además el camino del alta.

Y es exactamente lo que **destraba T-056**: hoy «cualquier omisión basada en estado del emisor
la destruye el trigger», porque el trigger borra el sobre anterior del emisor sin importar qué
llevaba. Con la compactación por `ckey`, el modelo que el emisor tiene de su propia porción del
buzón **es estable**, y "no reenviar lo que no cambió" pasa a ser una decisión local segura.

⚠️ **No verificado:** `purge_expired_envelopes()` (`001_mailbox.sql:81-91`) **no se llama desde
ningún lado del repo** y no hay migración que instale un cron. O el TTL está configurado a mano
en el panel de Supabase, o **no está corriendo**. Es una pregunta para el PO (§7) y cambia la
urgencia de la renovación, no su necesidad.

### 3.5 · `ckey` es opaca para el servidor

`ckey` **no puede ser el id del registro ni un prefijo de él**: le daría al relay un conteo de
registros y una forma de correlacionar el mismo gasto entre épocas. Se deriva del secreto del
grupo — `ckey = HMAC(GK, tipo ‖ prefijo)` truncada — igual que el `topic`
(`envelopeCrypto.ts:34-47`). El servidor sólo necesita igualdad.

Lo que el relay igual aprende: **cuántas rebanadas tiene un grupo**, o sea el orden de magnitud
de su tamaño. Ya lo deducía del tamaño de las filas. Se declara, no se esconde.

---

## 4 · Qué pasa con los cuatro mecanismos

| # | mecanismo | bajo R′ |
|---|---|---|
| 1 | **Compactación** (`004_compaction.sql`) | **Sobrevive re-escalado.** La clave pasa de `(topic, sender)` a `(topic, sender, ckey)`. El argumento del docblock se conserva palabra por palabra, ahora por rebanada: borrar un sobre viejo de la misma `ckey` no pierde nada porque el nuevo lleva el estado **completo de esa rebanada**. **Obligación nueva:** el conjunto de `ckey` que publica un emisor tiene que cubrir todos sus registros. Es lo que verifica el manifiesto, y tiene que estar cubierto por tests. |
| 2 | **TTL de 30 días** | **SE ROMPE sin la renovación de §3.4.** Con ella, se conserva sin tocar el servidor. |
| 3 | **Descarte de sobres sin firma** (`envelopeSign.ts:65-66`) | **El comentario deja de ser cierto y hay que corregirlo.** "Lo reemplaza la próxima publicación" pasa a significar "la próxima publicación **de esa rebanada**", que puede tardar hasta la renovación. El costo deja de ser nulo: pasa a estar **acotado por la ventana de renovación**. Para un emisor legítimo no cambia nada (sus propios sobres siempre verifican). |
| 4 | **P-2 · el que entra ve todo** | **Intacta, y por la misma razón que hoy.** El que entra lee desde `seq` 0 del topic de su época; la unión de lo retenido es el estado completo (R′); `applyDelta` lo mergea por LWW. **No recibe ninguna clave vieja** — la regla de `02_architecture.md:659` se conserva verbatim. Lo que cambia es que lee K×M sobres en vez de M, con el costo de §3.2. |

**Pendiente que R′ vuelve obligatorio:** la rotación de época cambia el `topic`, así que el
buzón nuevo arranca vacío y **hay que publicar TODAS las rebanadas al rotar**, no sólo las que
cambiaron. Hoy sale gratis porque cada publicación lleva todo. *(No hay rotación implementada:
`groupKeyStore.ts:54` crea siempre `epoch: 1` y nada lo incrementa. Es una obligación para
cuando se implemente, no un bug vivo.)*

---

## 5 · Compatibilidad — sin día de corte

`mergeByIdLWW` es una **unión**, nunca una resta (`src/store/lww.ts:54-59`), y `applyDelta`
tolera listas ausentes con `?? []` (`useSyncQR.ts:137-141`). Un delta con un subconjunto de
registros ya es un delta válido hoy.

| publica | lee | resultado |
|---|---|---|
| viejo (estado completo, `ckey` null) | viejo | idéntico a hoy |
| viejo | nuevo | funciona — un emisor sin manifiesto se trata como "legado, no declara completitud" |
| nuevo (rebanadas) | **viejo** | **funciona sin cambiar una línea del lector viejo**: cada rebanada es un `SyncDelta` legal y se mergea. El manifiesto lo ignora por el guard de `version` |
| nuevo | nuevo | completo |

**No hay flag day. Un teléfono con la versión vieja puede seguir publicando sobres viejos por
tiempo indefinido.** Lo único que NO se arregla es el grupo del teléfono viejo que ya se pasó
del techo: sigue sin publicar. Es el estado actual, no una regresión.

> **Orden obligatorio del despliegue: PRIMERO la migración, DESPUÉS la app.** El trigger de hoy
> borra *todos* los sobres compactables anteriores del emisor, así que un cliente nuevo
> publicando contra el servidor viejo se borraría su propia rebanada 1 al publicar la 2. La
> migración es prerrequisito duro y el trigger nuevo tiene que conservar el comportamiento
> actual para `ckey is null`.

---

## 6 · Lo que exige del servidor — **MIGRACIÓN QUE APLICA EL PO A MANO**

Un archivo, `supabase/006_compaction_por_rebanada.sql`. **Ninguna fila se borra ni se
reescribe; ninguna columna existente cambia de tipo.**

| cambio | detalle |
|---|---|
| **1 columna nueva** | `ckey text` en `public.envelopes`, **nullable**, sin default. `null` = sobre del formato viejo. |
| **1 trigger reemplazado** | `compact_envelopes()`: agregar `and ckey is not distinct from new.ckey` al `delete`. Con `ckey is null` el comportamiento queda **idéntico al de hoy** ⇒ los clientes viejos no notan nada. |
| **1 índice reemplazado** | `envelopes_compact_idx` pasa a `(topic, sender, ckey, seq) where compactable`. Sin esto cada inserción escanea la tabla. |
| **0 cambios de RLS** | El `CHECK` de 262.144 y las políticas quedan como están. |

**Filas y bytes:** el buzón guarda hoy M sobres de estado completo por topic (uno por miembro,
gracias al trigger) ≈ 5 × 320 KB ≈ **1,6 MB** en el escenario B. Bajo R′ con compactación por
`ckey`, guarda M×K sobres cuyo **total es el mismo estado** ⇒ **los bytes no cambian; sólo sube
el conteo de filas** (de 5 a ~50 con K=10). Es la migración la que mantiene ese empate: sin
`ckey`, para publicar rebanadas habría que poner `compactable=false` y el buzón acumularía toda
la historia de ediciones de 30 días.

**Efecto colateral a medir, no a suponer:** `fetchSince` pagina de a 200
(`relay.ts:163,174`). Con más filas por topic, el drenaje tiene que iterar hasta agotar en vez
de asumir una sola vuelta.

---

## 7 · Preguntas para el PO (P-3 — no las decide el arquitecto)

- **P-11 · ¿Está corriendo el TTL?** `purge_expired_envelopes()` no se llama desde el repo y no
  hay cron versionado. ¿Está agendado a mano en Supabase? De la respuesta depende cuánta
  urgencia tiene la renovación y cuánto hay acumulado hoy.
- **P-12 · Qué se le muestra al usuario cuando el manifiesto no cierra.** Opciones: (a) cartel
  "faltan datos de un miembro, los balances pueden estar incompletos" sobre el balance, como
  hoy con `too_large`; (b) ocultar el balance hasta que cierre; (c) nada, sólo diagnóstico.
  Es fricción contra certeza sobre plata. **Recomendación técnica: (a)** — es el patrón que el
  proyecto ya eligió en T-058 y no bloquea el uso offline.
- **P-13 · Borrado por un tercero que conoce el topic.** Ver §8, riesgo 1. Hay dos caminos y
  cuestan muy distinto.

---

## 8 · Riesgos — dónde se corrompe plata

**1 · La compactación por `ckey` afila un vector de borrado que ya existía.**
`004_compaction.sql:33-34` afirma hoy: «Un atacante con la anon key puede, como mucho, hacer
que se borren los suyos». **Bajo R′ esa frase deja de ser cierta.** `sender` es un string que
el cliente elige sin autenticación (`relay.ts:86-93`) y la política de lectura es
`using (true)` (`001_mailbox.sql:65-68`) ⇒ cualquiera que conozca el topic puede leer los
`sender` ajenos, insertar una fila con `sender` ajeno + `ckey` ajena, y **hacer desaparecer del
buzón la rebanada legítima**. Hoy el mismo ataque es inofensivo porque los otros M−1 miembros
tienen cada uno una copia completa. Bajo R′ el ataque hace un agujero real, y el manifiesto lo
convierte en **visible** pero no lo impide.
*Acotado por:* sólo lo puede hacer quien deriva el `topic`, o sea quien tiene o tuvo `GK_N` —
un miembro o un ex-miembro de la época. Nunca alguien de afuera.
*Caminos:* (a) aceptarlo declarado + manifiesto + renovación (barato, es P-13); (b) verificar
la firma en el servidor antes de borrar — **contradice ADR-003**, que descartó explícitamente
la criptografía del lado del servidor. **No elijo: es P-13.**

**2 · Historial parcial que se ve completo.** El riesgo estructural de R′. Un buzón al que le
falta una rebanada produce balances mal calculados presentados como definitivos. **Mitigación
obligatoria, no opcional: el manifiesto (§3.3).** Si el manifiesto no entra en el alcance, R′
no debe implementarse.

**3 · Tombstones que no llegan.** Una rebanada perdida con un `isDeleted: true` adentro
**resucita** un gasto borrado en el device que no la recibió. Es el mismo riesgo 2 con el signo
invertido, y la misma mitigación.

**4 · La renovación como punto único de falla silenciosa.** Si el pase de renovación falla o
no corre (app que nunca se abre 30 días), el buzón se vacía de a poco **sin que nadie pierda
datos locales**, y el daño aparece recién cuando alguien entra al grupo. Necesita su propia
señal de salud, como `publishHealth`.

**5 · La medición vieja se aplica a un diseño nuevo.** Las cifras de T-056 miden el sobre
completo. Ninguna de ellas dice cuánto pesa una rebanada, ni cuánto cuesta el alta con K×M
sobres. **Nada de esto se implementa antes de medirlo** (§9 del plan T-058).

**6 · Inversión de costos en `drainGroup`.** `relaySync.ts:140` verifica la firma «ANTES de
gastar una operación de cifrado». Con `ed25519.verify` en 37,57 ms y un AEAD simétrico sobre
unos pocos KB, **el orden está probablemente invertido en este hardware**: el descarte barato
sería abrir el sobre, no verificar la firma. No lo afirmo — hay que medirlo. Si se confirma,
invertir el orden es lo que permitiría rebanadas mucho más finas, y es una decisión con
consecuencias de seguridad que merece su propia entrada en este ADR.

---

## 9 · Alternativas descartadas

| alternativa | por qué no |
|---|---|
| **Filtrar por fecha (regla #8 de `CLAUDE.md`)** | Rompe los tres mecanismos de §2 y P-2. Superada a conciencia por el diseño del relay; la regla es la que está desactualizada. |
| **Subir `MAX_PAYLOAD_BYTES`** | (a) No es un número del cliente: está replicado en el `CHECK` (`001_mailbox.sql:48`) **y** en la política de INSERT (`001_mailbox.sql:73`) ⇒ subirlo **también exige migración**, y sin ella el cliente cambia un error accionable por un 400 opaco de Postgres. (b) **No arregla nada**: el payload es O(gastos) y no para de crecer — 868 KB a 500 gastos, y T-041 suma pendiente. Cualquier constante se pasa; mover el acantilado de los 6 meses a los 18 no es un diseño. (c) Multiplica el tráfico por edición en vez de bajarlo. **Límite real por arriba, verificado:** el `text` de Postgres tolera hasta 1 GB, y la documentación de Supabase fija el payload de `postgres_changes` en **1.024 KB**, por encima del cual el registro se entrega recortado a los campos de ≤64 bytes ([Realtime limits](https://supabase.com/docs/guides/realtime/limits)) — irrelevante acá porque `subscribeTopic` **descarta** el registro y sólo usa el aviso (`relay.ts:195-206`). **No pude verificar un límite documentado de tamaño de request del Data API de Supabase; me abstengo de afirmar uno.** |
| **Sacar las fotos / `avatarUrl` / `receiptImageUri`** | Medido: el escenario B **sin ninguna foto** queda en 104,8 % ⇒ sigue sin publicar. Vale igual como higiene y como parte de las rebanadas (§3.1), no como solución. |
| **Un sobre por registro** | 37,6 s de hilo JS bloqueado para el que entra a un grupo de 200 gastos (§3.2). Vuelve viable sólo si antes se resuelve el riesgo 6. |
| **Cola con delete-on-ack (SQS/RabbitMQ), propuesta del PO en T-032** | **Se mantiene descartada, con sus razones originales:** rompe el replay que exige P-2, expone el grafo social al relay, el contador se rompe ante alta de miembros / reinstalación / multi-device, y exige permitir UPDATE con la anon key ⇒ vector de pérdida de datos. R′ consigue el objetivo (no reenviar lo que no cambió) **sin** ninguna de esas cuatro consecuencias. |
| **Compactación por `(topic, ckey)`, sin `sender`** | Tapa el agujero del "dispositivo abandonado que deja de renovar", pero le da a cualquiera que conozca el topic la capacidad de borrar la rebanada de **todos** los emisores de una vez. Cambia un problema acotado por otro peor. |
| **Un emisor líder por registro (sin redundancia M×)** | Ahorra el factor M de filas, pero exige elección de líder y se rompe con la pérdida del dispositivo — la coordinación que el modelo CRDT evita a propósito. El factor M es además lo que hoy da robustez ante el riesgo 1. |
| **Quitar el TTL / eximir a los compactables** | Entrega la política de retención al servidor, donde el cliente no la puede verificar, y deja los grupos muertos ocupando lugar para siempre. La renovación deja el control del lado que sí sabe qué tiene. |

---

aprobado por · Arquitecto (NERV) · 2026-08-31 · **pendiente de P-11/P-12/P-13 del PO**
