# Publicación incremental: rebanadas estables por prefijo de id + publicar sólo lo que cambió

**Fecha:** 2026-09-28 · **Decisión del PO:** enfoque B («vamos con B») · **Rama:** `feat/publicacion-incremental` (no se mergea a `main` sin OK del PO) · **Ticket:** T-191

## 1 · Problema

Cada cambio en un grupo publica **todo** el estado del grupo: `publishToGroup` (`src/sync/relaySync.ts:286-350`) arma todas las rebanadas y manda cada una, siempre, más el manifiesto. Con 5 rebanadas de 64 KB, cargar un gasto de 400 bytes cuesta 6 sobres y ~320 KB de subida, y en el receptor 6 verificaciones de firma a 37 ms cada una. Además las rebanadas se cortan **por orden de id** (`sliceEntities`, `src/sync/slices.ts:60-110`), así que un id nuevo que ordena antes corre todos los cortes y cambia las rebanadas siguientes: un alta toca varias rebanadas aunque se mandara sólo lo que cambió.

ADR-007 (`docs/ADR-007-el-estado-vive-en-el-buzon.md` §3.1 y §3.4) ya decidía partir «primero por tipo, después por prefijo de id» y «no reenviar lo que no cambió». Lo primero se implementó por índice (T-146) y lo segundo quedó a medias: existe el reloj de renovación (`src/sync/sliceRenewal.ts`, 20 días) pero `publishToGroup` no lo consulta.

## 2 · Decisión

Dos cambios, sin tocar el servidor (la compactación por `(topic, owner, ckey)` de `010_ckey_compaction.sql` ya es la que hace falta) y sin compatibilidad hacia atrás (no hay usuarios).

### 2.1 · Rebanadas estables por prefijo de id

- Para cada campo rebanado (`groups, expenses, payments, users, recurring, comments`), cada registro va al **cubo** que le corresponde por el prefijo hexadecimal de su `id` (UUID en minúsculas; si un id no es UUID, se toma el prefijo de `sha256(id)`).
- **Profundidad** `d` del prefijo por campo: la menor `d ≥ 1` tal que todos los cubos del campo quedan por debajo de `TARGET_SLICE_BYTES` (64 KB). Con `d = 1` hay 16 cubos; `d = 2`, 256. La profundidad se recalcula en cada publicación; cambia sólo cuando el grupo crece (una vez cada varios miles de registros) y ahí se republica el campo entero una vez.
- `ckey = sha256(clave_del_grupo : 'ckey' : campo : prefijo)` (`deriveCkey`, misma fórmula; el «índice» pasa a ser el prefijo). Sigue siendo opaca para el servidor (ADR-007 §3.5): sin la clave del grupo nadie deduce el prefijo.
- Cubos vacíos no se publican ni figuran en el manifiesto. Los registros nunca desaparecen (tombstones), así que un cubo que existió no se vacía.
- Tope duro por cubo: `MAX_SLICE_BYTES` (256 KB). Un registro que solo supere el tope se excluye como hoy (`excesoDe`, T-150). Un cubo que supere el tope a profundidad máxima (`d = 4`) se publica igual y `sendEnvelope` lo rechaza como hoy: es un grupo de decenas de miles de registros; se registra y no se diseña para eso.
- Efecto: un alta o una edición tocan **una sola rebanada** por campo. El tope práctico de gastos por grupo pasa de ~450 (un solo sobre de 1 MB) a varios miles (256 KB por cubo, 16 o 256 cubos).

### 2.2 · Publicar sólo lo que cambió (o venció)

- Registro local por `ckey`: `{ digest, publicadaEn }` (`src/sync/relay/sliceLedger.ts`, MMKV scopeado por cuenta; reemplaza a `sliceRenewal.ts`, que sólo guardaba `publicadaEn`).
- Al publicar: se arman los cubos y sus digests. Se manda un cubo si **cambió el digest** o si `ahora - publicadaEn > RENEWAL_WINDOW_MS` (20 días; TTL del buzón 30). El manifiesto se manda **siempre** y lista todos los cubos presentes con su digest.
- Se registra `{digest, publicadaEn}` recién cuando `sendEnvelope` confirmó (mismo criterio que hoy, Fix 3 de T-146).
- Si el registro local se pierde (reinstalación, backup restaurado), se republica todo una vez. Es el camino del alta y es correcto.
- El envío sigue por `relayQueue` (15/min bajo la cuota de 20/min). Una publicación completa de un grupo grande (hasta ~30 sobres) tarda 1-2 minutos; una publicación normal, 2 sobres (cubo + manifiesto).

### 2.3 · El receptor recuerda qué rebanadas aplicó

Hoy el chequeo del manifiesto (`drainGroup`, `relaySync.ts:~640-700`) compara las entradas del manifiesto con un mapa **en memoria de ese drenaje** (`recibidasPorRemitente`). Con publicaciones parciales, un cubo que no viajó porque no cambió daría un falso «falta».

- Registro local por `(topic, sender, ckey) → digest` de la última rebanada **aplicada** (`src/sync/relay/appliedSlices.ts`, MMKV scopeado por cuenta, acotado a los grupos con clave; se borra con el grupo).
- El chequeo del manifiesto usa `recibidas en este drenaje ∪ aplicadas antes`. Falta = entrada del manifiesto cuyo `ckey` no está en ninguno de los dos, **o** cuyo digest no coincide con ninguno de los dos (el emisor declara una versión que este teléfono no tiene: la pide releyendo desde el cursor 0 de ese topic una vez, con presupuesto de `drainFailures`).
- Quien entra nuevo lee desde el cursor 0: el buzón conserva la última versión de cada cubo por emisor (compactación 010), así que recibe todo y el manifiesto cierra.
- Cambio de profundidad: los cubos de la profundidad vieja quedan en el buzón hasta el TTL. Un receptor que los aplique después recibe versiones **más viejas** de registros que ya tiene; el merge por niveles con `rev`/`updatedAt` (T-041/T-144) las descarta. No hace falta borrarlos.

### 2.4 · Frontera de reutilización (para la librería `relay` del plan Nx)

El núcleo del relay opera sobre un **documento genérico**: `Documento = Record<campo, { id: string }[]>`. Todo lo de §2.1-2.3 (cubos, digests, ledger, manifiesto, aplicadas) vive en `src/sync/relay/` y **no importa stores ni tipos de gastos**. Lo específico de HushSplit queda en un adaptador explícito, `src/sync/relay/adaptadorHushSplit.ts`:

| Función | Hoy | Después |
|---|---|---|
| `SLICED_FIELDS` | constante en `relaySync.ts` | `adaptador.campos` |
| `buildGroupPayload` | `relaySync.ts:73` lee los stores | `adaptador.armar(groupId, userId): Documento` |
| `applyDelta` | `useSyncQR.ts:125` escribe los stores | `adaptador.aplicar(doc, userId)` |
| `acotarDeltaAlGrupo` | `src/sync/acotarDeltaAlGrupo.ts` | `adaptador.acotar(doc, groupId)` |
| fotos por referencia (`users`) | inline en `buildSlicedEnvelopes` | `adaptador.antesDePublicar(doc)` |

`relaySync.ts` pasa a ser el que enchufa núcleo + adaptador. No se muda nada a una librería en este trabajo: se dibuja la frontera con tipos y un test guard (ningún archivo de `src/sync/relay/` importa `@/src/store/*` ni `@/src/types/models`, salvo el adaptador).

## 3 · Lo que no cambia

Formato del sobre (cifrado + firma), `MANIFEST_VERSION`, compactación y TTL del servidor, `relayQueue`, cursores por topic, merge por niveles, `acotarDeltaAlGrupo` (sólo cambia de lugar), regla 8 de CLAUDE.md (el buzón sigue conteniendo el estado completo; lo que cambia es que cada publicación aporta sólo la parte que cambió).

## 4 · Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Un teléfono se pierde un cubo y cree estar completo | manifiesto + `appliedSlices`: falta detectable → relectura desde 0 con presupuesto |
| Digest igual con contenido distinto | SHA-256 sobre el JSON exacto que viaja; mismo `digestOfJson` del manifiesto |
| El ledger dice «publicado» pero el buzón lo perdió (TTL, purga) | renovación a 20 días; y `delete_my_envelopes` al borrar cuenta limpia el ledger |
| Cambio de profundidad a mitad de camino en dos teléfonos | cada emisor decide su partición; el receptor no depende de coincidir (ADR-007 §3.1) |
| Cubo que supera 256 KB | mismo tratamiento que hoy (`too_large`, aviso); documentado como fuera de alcance |
| Cuota al republicar todo | `relayQueue` ya la respeta; la republicación completa es rara |

## 5 · Tests (un test por fila; los † son de integración con `publishToGroup`/`drainGroup` reales y buzón simulado)

| # | Estado | Esperado |
|---|---|---|
| P1 | 300 gastos, `d=1` | 16 cubos como máximo, cada uno < 64 KB; ningún registro en dos cubos; unión = todos |
| P2 | id no UUID | va al cubo de `sha256(id)`; determinista |
| P3 | campo que a `d=1` supera 64 KB en algún cubo | `d=2`; todos los cubos < 64 KB |
| P4 | alta de un gasto | sólo cambia el digest de UN cubo del campo `expenses` |
| P5 | edición de un gasto | idem |
| P6 | † segunda publicación sin cambios | se manda sólo el manifiesto (1 sobre) |
| P7 | † edición de un gasto | se mandan 2 sobres: el cubo y el manifiesto |
| P8 | † cubo sin cambios pero con `publicadaEn` > 20 días | se reenvía (renovación) |
| P9 | † ledger vacío (reinstalación) | se publica todo |
| P10 | † receptor: publicación parcial después de una completa | manifiesto cierra sin «falta» (usa `appliedSlices`) |
| P11 | † receptor: manifiesto declara un digest que no tiene | «falta» registrada; relectura desde 0 una vez; después cierra |
| P12 | † quien entra nuevo con cursor 0 | recibe todos los cubos y el manifiesto cierra |
| P13 | † cambio de profundidad `d=1→2` | el emisor republica el campo; el receptor termina con el estado correcto aunque lleguen cubos viejos después (LWW) |
| P14 | † ckey opaca | dos grupos con los mismos ids producen ckeys distintas |
| P15 | guard de frontera | ningún archivo de `src/sync/relay/*` salvo el adaptador importa stores o `types/models` |
| P16 | † borrar grupo / cambiar clave | `appliedSlices` y ledger de ese topic se limpian |
| P17 | tamaño del sobre (bench existente `tamanoDelSobre.bench.test.ts`) | sigue bajo el tope; documenta el nuevo costo por edición |

## 6 · Estimación

6 a 8 días de agentes con verificación (Strong: toca el formato de lo que viaja), más prueba del PO entre dos teléfonos. Éxito estimado 85%: la lógica de merge no cambia y el servidor no cambia; lo delicado es §2.3.

## 7 · Revisión del arquitecto

**Veredicto: CAMBIAR C1-C6 antes del plan.** El enfoque es correcto y el servidor no se toca (`010_ckey_compaction.sql:49-56` ya compacta por `(topic, owner_tag, ckey)`). Pero hay dos defectos que rompen el objetivo o pierden datos (C1, C2) y cuatro premisas falsas o incompletas. Revisado contra `main @ 2c0703c`.

**C1 · Bloqueante: tal como está escrito, el digest cambia en CADA publicación y §2.2 nunca omite nada.** El JSON de cada rebanada lleva `timestamp: delta.timestamp` (`relaySync.ts:250-258`), que es `Date.now()` (`relaySync.ts:86`). El merge no lo lee: `applyDelta` no usa `timestamp` (`useSyncQR.ts:123-150`), y `acotarDeltaAlGrupo` sólo lo copia (`acotarDeltaAlGrupo.ts:170`). → El JSON del cubo tiene que ser determinista: `timestamp` fijo (0) u omitido, y los registros ordenados por `id` dentro del cubo. Test nuevo: dos publicaciones sin cambios dan JSON idéntico byte a byte.

**C2 · Pérdida silenciosa: el orden de campos, que hoy es load-bearing, se rompe.** Hoy cada publicación reenvía todas las rebanadas en el orden de `SLICED_FIELDS`, y el drenaje confía en ese orden por `seq` (`relaySync.ts:120-133`, `512-517`). Con cubos incrementales el `seq` refleja **cuándo se tocó por última vez** cada cubo. Un caso concreto: se edita otro gasto con el mismo prefijo, el cubo de `expenses` vuelve a salir y queda con un `seq` MAYOR que el cubo de `comments`. Quien entra lee primero los comentarios, y `acotarDeltaAlGrupo.ts:154-160` los tira **sin contarlos en `descartados`**. Con `users` pasa lo mismo frente a `groups` (`:162-164`). Después `appliedSlices` marca ese cubo como aplicado, el manifiesto cierra y nunca se vuelve a pedir. → Cuando una rebanada pierde registros **por dependencia** (comentario sin gasto, usuario no miembro), se retiene en memoria y se vuelve a aplicar al final del drenaje, después de todas las páginas. Sólo se registra en `appliedSlices` cuando no le quedan descartes por dependencia. Los descartes por tope (`excesoDe`) son permanentes y sí se registran. Test: quien entra con `seq(comments) < seq(expenses)` termina con todos los comentarios.

**C3 · §2.1 profundidad: sí oscila, y el salto de 16 a 256 es demasiado grosero.** El tamaño de un cubo no crece de forma monótona: editar una nota lo achica. Recalculado en cada publicación cerca de los 64 KB, `d` alterna 1↔2, y cada alternancia republica el campo entero (hasta 256 sobres) y deja huérfanos hasta el TTL. → **Histéresis:** `d` se guarda en el ledger por `(topic, campo)` y **nunca baja**. Sube cuando algún cubo supera `SPLIT_BYTES`. Si se pierde el ledger, se recalcula desde cero (de todos modos es una republicación completa). Al subir, se publica `[]` en las ckeys de la profundidad vieja para que la compactación las borre ya (16 sobres), en vez de esperar al TTL. **Canje para el PO (P-3), no lo elijo yo:** (A) `SPLIT = 64 KB`, como dice la spec: una edición sube ≤64 KB, pero con ~2.000 gastos pasa a `d=2`. Quien entra a un grupo de 5 miembros verifica entonces ~5×(256+256+~40) ≈ 2.760 sobres × 37,57 ms ≈ **104 s** (compárese con la tabla de ADR-007 §3.2, que da 1,9 s). (B) `SPLIT ≈ 192 KB`, debajo del tope de 256: una edición sube hasta ~192 KB, pero se queda en 16 cubos por campo hasta ~6.000 gastos. Alternativa descartada: partir sólo el cubo que se pasa (un trie), porque la profundidad variable por cubo complica el manifiesto y los tests sin que haya un número medido que lo pida.

**C4 · §2.2 y §4: la premisa sobre `relayQueue` es falsa.** `publishToGroup` llama a `sendEnvelope` directo (`relaySync.ts:335`). La cola sólo la usan claves y contactos (`relayQueue.ts:6-12`, `relay/contactos.ts:55,153,198`). Peor caso con `d=2` y 6 campos: 6×256+1 = **1.537 sobres**. El caso realista es `groups` y `users` en `d=1` y `expenses`/`comments` en `d=2`, alrededor de 550 sobres, no «~30». Igual converge: sale una ráfaga de ~20 sobres, llega `rate_limited`, y `reintentarPublicacionesConCuota` hace un intento por vuelta de poll (`relay/publish.ts:139-144`). Como el ledger registra cubo por cubo, cada vuelta avanza unos 20: ≈550/20 × 90 s ≈ **40 min** para el caso realista. Mientras tanto se come la cuota compartida con los envíos de claves `alta`. → Corregir §2.2, §3 y §4. Encolar la republicación masiva en `relayQueue` con prioridad `normal` es opcional, pero el texto no puede decir que ya se hace.

**C5 · Claves de los registros locales.** (a) El ledger por `ckey` sola está mal: `deriveCkey` no incluye la época (`slices.ts:50-55`) y el topic sí (`relaySync.ts:304`). Al rotar época, el ledger daría todo por publicado en un buzón vacío, justo lo que ADR-007 §4 prohíbe. Tampoco incluye el emisor: si se restaura un backup de MMKV con otro `deviceId` (`relay/cursor.ts:35-40`), sale un manifiesto que declara cubos que ese emisor nunca publicó. → La clave es `(topic, deviceId, ckey)`. (b) El ledger de un topic se borra, además, en `deleteMyGroupEnvelopes` (`relaySync.ts:368-377`) y en `marcarPendienteDeDrenaje` (`pendingDrain.ts:67-72`). Si no, al reingresar se publica sólo el manifiesto sobre un buzón purgado. (c) `appliedSlices` guarda `{digest, seq, senderKey}`. Una entrada del manifiesto **se cumple** si el digest coincide **o** si el cubo aplicado tiene `seq` mayor que el del manifiesto. El segundo caso es una publicación en curso cortada por la cuota: sin esa regla da un falso «falta» que gasta la relectura. Además, el cubo y el manifiesto tienen que estar firmados por la misma `senderKey`, porque `sender` no está autenticado (ADR-007 §8.1).

**C6 · El presupuesto de relectura no puede ser `drainFailures`.** Ese presupuesto cuenta por `(topic, seq)` y en memoria (`drainFailures.ts:26-48`). Cada relectura desde 0 ve el mismo `seq` ya agotado, así que no pone ningún límite a las relecturas. → Un contador propio: como máximo **una** relectura por `(topic, sender, seq del manifiesto)`, en memoria. Si después de releer sigue faltando, se registra en `manifestHealth` (`manifestHealth.ts:18-24`) y no se vuelve a releer hasta que llegue un manifiesto nuevo. Así no puede ciclar. Una relectura de un grupo de 5 miembros en `d=1` son ~5×60 sobres ≈ 11 s de verificación, que es aceptable una vez por versión de manifiesto.

**Respuestas a (3), (4) y (6) de la consigna:**
- **(3) Cubos viejos aplicados después.** Se descartan en todos los tipos, y hoy ya pasa lo mismo con los sobres de otros emisores. El núcleo gana por firma y después por `rev`, el resto por `updatedAt` con tope de reloj (`mergeLevels.ts:20-31`). Los campos colaborativos se unen por entrada: `miembros` con su propio tope en `unirMiembrosDeGrupo` (`mergeLevels.ts:103-121`), y `memberIds` se recalcula (`mergeGroupsPure.ts:24-32`). `comments` y `recurring` usan `mergeByIdLevels` sin nada más. `users` usa LWW con tope (`mergeUsersLWW.ts:49`), y la foto se pide con el digest ya mergeado (`relaySync.ts:669`). **Excepción:** un registro que **sale** del payload (traspaso de grupo, miembro que se va) deja su cubo viejo en el buzón hasta el TTL. Quien entra y no tiene el grupo destino lo acepta (`acotarDeltaAlGrupo.ts:86-87`). → Cuando un cubo que figura en el ledger queda vacío, se publica `[]` en su ckey. Esto corrige la afirmación de §2.1 «un cubo que existió no se vacía».
- **(4) `pendingDrain` y `sliceRenewal`.** La guarda de T-089 sigue en `publishNow` (`relay/publish.ts:82-85`) y no cambia, salvo por C5(b). `avatarTopic` usa `staleSliceCkeys`/`recordSlicePublished` con marcadores propios y una ventana corta (`avatarTopic.ts:71,79,126-127`). → **No reemplazar** `sliceRenewal.ts`: queda para las fotos, y el ledger va en un namespace nuevo.
- **(6) Frontera.** `antesDePublicar(doc)` no alcanza. Hoy ese paso **manda un sobre** (`publishAvatarIfOwn`, que se espera antes que la rebanada, `relaySync.ts:221`) y necesita `groupId`/`deviceId`. Debe ser `antesDePublicar(doc, ctx)`, con el efecto documentado. Otras dos cosas quedan del lado del adaptador: el adaptador tiene que **envolver** el cubo como `SyncDelta` `version: 1`, porque si no `applyDelta` lo descarta (`useSyncQR.ts:123`), y tiene que declarar el orden de dependencia que usa C2. El scoping por cuenta vive en `src/store/userScope`, y eso choca con el guard P15. → El almacenamiento se inyecta como puerto `{get,set,delete}` desde el adaptador.

**Riesgo declarado, no bloqueante:** si un emisor queda en silencio, su manifiesto puede sobrevivir hasta 20 días a un cubo vencido (manifiesto del día 15 con el cubo del día 0). Quien entra ve el «falta», lo cual es correcto porque es ruidoso y no silencioso, y los datos le llegan por los otros miembros. Corresponde a ADR-007 §8.4: la señal de salud de la renovación sigue pendiente.

**Tests a agregar:** P18 (C1: JSON idéntico entre publicaciones), P19 (C2), P20 (profundidad monótona y huérfanos puestos en `[]`), P21 (C5(c) con un manifiesto viejo y un cubo más nuevo: sin falta), P22 (C6: una sola relectura), P23 (C5(b): reingreso → republicación completa).

— aprobado por · nerv-arquitecto · 2026-09-28 (condicionado a C1-C6)

## 8 · Decisiones tras la revisión (orquestador, 2026-09-28) — cierran C1-C6; esto es lo que se implementa

- **C1 · JSON determinista.** El cubo NO lleva `timestamp` (se omite; `applyDelta`/`acotarDeltaAlGrupo` no lo leen) y los registros van ordenados por `id` dentro del cubo. El digest se calcula sobre ese JSON exacto. Test P18: dos publicaciones sin cambios ⇒ JSON idéntico byte a byte y sólo viaja el manifiesto.
- **C2 · Dependencias entre campos.** El adaptador declara el orden de dependencia (`groups → users → expenses → payments → recurring → comments`) y `acotar` devuelve los descartes **por dependencia** aparte de los descartes por tope. En un drenaje, una rebanada con descartes por dependencia se retiene en memoria y se vuelve a aplicar al final, después de la última página; sólo se registra en `appliedSlices` cuando no le quedan descartes por dependencia. Test P19: quien entra con `seq(comments) < seq(expenses)` termina con todos los comentarios.
- **C3 · Profundidad con histéresis.** `SPLIT_BYTES = 192 KB` (opción B: una edición sube a lo sumo ~192 KB, 16 cubos por campo hasta ~6.000 gastos; quien entra a un grupo de 5 miembros verifica ~5×60 sobres ≈ 11 s). `d` se guarda en el ledger por `(topic, campo)` y **nunca baja**; sube cuando algún cubo supera `SPLIT_BYTES`; al subir se publica `[]` en las ckeys de la profundidad anterior. Tope duro por cubo sigue en `MAX_SLICE_BYTES` = 256 KB. Test P20.
- **C4 · Cuota, con números corregidos.** `publishToGroup` no pasa por `relayQueue` y así queda: la republicación completa de un grupo en `d=1` son a lo sumo ~40 sobres (16 `expenses` + 16 `comments`/`payments` en el peor caso + 1 por los campos chicos + manifiesto), que con la cuota de 20/min y el reintento por vuelta de poll tarda ~3 minutos. Los números de §2.2 («1-2 minutos», «~30 sobres») quedan reemplazados por estos. Encolar la republicación masiva en `relayQueue` se anota como mejora posible, no se hace acá.
- **C5 · Claves de los registros locales.** Ledger por `(topic, deviceId, ckey) → { digest, publicadaEn }` y profundidad por `(topic, campo)`. Se borra el ledger del topic en `deleteMyGroupEnvelopes` y en `marcarPendienteDeDrenaje` (reingreso ⇒ republicación completa, test P23). `appliedSlices` por `(topic, sender, ckey) → { digest, seq, senderKey }`; una entrada del manifiesto se cumple si el digest coincide **o** si el cubo aplicado tiene `seq` mayor que el manifiesto (publicación en curso cortada por la cuota, test P21); cubo y manifiesto tienen que compartir `senderKey`. Cuando un cubo que figura en el ledger queda vacío (traspaso, miembro que se va), se publica `[]` en su ckey; §2.1 «un cubo que existió no se vacía» queda corregido.
- **C6 · Relectura acotada.** Contador propio en memoria: a lo sumo **una** relectura desde el cursor 0 por `(topic, sender, seq del manifiesto)`. Si sigue faltando, se registra en `manifestHealth` y no se relee hasta que llegue un manifiesto nuevo. Test P22.
- **Frontera (respuesta 6).** `antesDePublicar(doc, ctx: { groupId, deviceId })` con efecto documentado (manda la foto propia). El adaptador envuelve cada cubo como `SyncDelta` `version: 1` para `applyDelta`, declara el orden de dependencia (C2) y provee el puerto de almacenamiento scopeado `{ get, set, delete }` al núcleo, que no importa `userScope`. `sliceRenewal.ts` **queda** para las fotos (`avatarTopic`); el ledger va en un namespace nuevo.
- **Tests:** P1-P17 de §5 más P18-P23 de §7.
