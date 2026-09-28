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
