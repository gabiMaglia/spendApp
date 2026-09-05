# ADR-009 · Borrar lo propio en el buzón — quién puede borrar qué del relay

**Estado:** PROPUESTO — pendiente de decisión del PO (§8)
**Enmienda a:** ADR-003 (`engram/02_architecture.md:298-581`), decisión 1 (buzón store-and-forward)
y su invariante de retención. **Cierra P-13 de ADR-007.** **Desbloquea T-074.**
**Fecha:** 2026-09-04 · **Autor:** nerv-arquitecto · **Nivel:** Adversarial (X)
**Exige migración de Supabase aplicada a mano por el PO sobre datos en producción — ver §6**

---

## 1 · Qué obliga a decidir esto

Dos cosas distintas necesitan la misma pieza, y ninguna de las dos puede avanzar sin ella:

1. **P-13 de ADR-007**, contestada por el PO el 2026-09-04, textual:
   *«cada usuario puede borrar datos de su propia potestad; un ex-miembro de un grupo ya no tiene
   acceso al grupo, no debería poder borrar datos pertinentes a este, sólo el registro propio que
   tenga; si lo meten de nuevo al grupo, arranca desde 0»*
   (`engram/09_plan_lanzamiento.md:281`). **No es ninguna de las dos opciones que ADR-007 ofrecía**
   (`docs/ADR-007-el-estado-vive-en-el-buzon.md:281-283`): es una tercera.
2. **T-074 · borrado de cuenta** (`engram/plans/T-074.md:39,46-57`), requisito duro de las dos
   tiendas. `relay.ts` sólo expone `sendEnvelope` (`src/sync/relay.ts:124`) y `fetchSince`
   (`src/sync/relay.ts:171`): no hay borrado.

---

## 2 · El estado real del servidor, verificado

| hecho | dónde |
|---|---|
| `sender` es un string que elige el cliente, sin autenticación | `src/sync/relay.ts:98-105`, `src/sync/relaySync.ts:103` |
| ...y ese string es `d_` + `Math.random()` + timestamp, guardado en MMKV local | `src/sync/relayEngine.ts:78-84` |
| ...no es la clave pública, ni el id de cuenta, ni nada verificable | mismo, más `src/sync/envelopeSign.ts:48-53` (la pública viaja en `k`, **dentro** del payload) |
| La política de lectura es `using (true)` | `supabase/001_mailbox.sql:65-68` |
| La de escritura sólo mira el tamaño | `supabase/006_payload_limit.sql:46-49` |
| No hay política de DELETE ni de UPDATE ⇒ RLS las niega | `supabase/001_mailbox.sql:75-76` |
| `pgcrypto` ya está instalada | `supabase/001_mailbox.sql:15` |
| El TTL de 30 días **ahora sí corre** (pg_cron, 03:15 UTC) | `supabase/007_ttl_cron.sql:31-35` |
| Sólo tres lugares del repo tocan la tabla, y los dos `select` piden columnas explícitas | `src/sync/relay.ts:144,181,215` — **no hay un solo `select('*')` en el árbol** |

### 2.1 · Hallazgo que cambia el planteo: la puerta de borrado YA está abierta

`001_mailbox.sql:75-76` afirma: *«Nadie borra ni edita sobres: sólo los expira la purga.»*
**Eso es falso desde `004_compaction.sql`.**

`compact_envelopes()` es `security definer` (`supabase/004_compaction.sql:39-40`) — **corre con los
permisos del dueño de la función y por lo tanto ignora la RLS** — y borra con
`where topic = new.topic and sender = new.sender and compactable and seq < new.seq`
(`004_compaction.sql:44-48`). Los tres valores del `where` vienen de la fila que **acaba de
insertar quien sea**.

Consecuencia, hoy, en producción: **cualquiera que conozca un topic puede leer el `sender` ajeno
(la lectura es `using(true)`) e insertar una fila con ese `sender` y `compactable = true`, y el
trigger le borra el sobre legítimo al dueño.** No hace falta ningún permiso de DELETE.

Por lo tanto el docblock de `004_compaction.sql:33-34` — *«Un atacante con la anon key puede, como
mucho, hacer que se borren los suyos»* — **es incorrecto**, y lo es desde que se corrió la
migración. Hoy el daño es acotado por accidente, no por diseño: cada uno de los otros M−1
miembros tiene una copia completa y la vuelve a publicar (`relaySync.ts:103`, sobre con estado
completo). ADR-007 anotó este vector como algo que R′ *afilaría* (`ADR-007:270-280`); la
verificación dice que **el primitivo de borrado ya está vivo**.

> **Esto reencuadra P-13.** No estamos decidiendo si abrimos una puerta de borrado. La puerta está
> abierta y sin llave. Estamos decidiendo si le ponemos cerradura — y, ya que estamos, si abrimos
> una segunda puerta (borrado explícito) detrás de la misma cerradura.
>
> **Corolario:** la opción «(a) aceptarlo declarado» de ADR-007 §8 riesgo 1 no es *no hacer nada*.
> Es aceptar un defecto vivo, no un riesgo futuro.

### 2.2 · Dos supuestos del encargo que no sobreviven a la verificación

**a) «Un token de escritura por miembro, derivado de la clave del grupo» no sirve.**
El atacante del modelo de amenaza **tiene `GK`**: ADR-007 lo dice explícito — *«sólo lo puede hacer
quien deriva el `topic`, o sea quien tiene o tuvo `GK_N`»* (`ADR-007:277-278`). Cualquier token
`f(GK, …)` lo computa él también. Y si el otro insumo es `sender`, peor: `sender` se lee del buzón
(`001_mailbox.sql:65-68`). Un token derivado de `GK` **sólo frena a los de afuera, que ya estaban
frenados por no conocer el topic**. Cuesta trabajo y no compra nada. **Descartado con razón, no
omitido.**

**b) «Un ex-miembro ya no tiene acceso al grupo» no es cierto hoy.**
La revocación de ADR-003 es la rotación de época (`02_architecture.md`, §1.4 del ADR), y **la
rotación no existe**: `groupKeyStore.ts:54` crea siempre `epoch: 1` y nada la incrementa —
verificado por grep sobre todo `src/`, y ya anotado en `ADR-007:236-238`. El que se fue conserva
`GK_1` y el topic para siempre. ADR-003 además ya lo había declarado como irreducible:
*«Quien sale del grupo conserva para siempre lo anterior a su salida»*
(`02_architecture.md`, §Consecuencias).

> **Por eso este ADR no intenta distinguir «miembro» de «ex-miembro» en el servidor: no puede.**
> Lo que sí puede es una propiedad más chica que alcanza para todo lo que el PO pidió:
> **sólo borra una fila quien puede PROBAR que la escribió.** «Su propio registro» se resuelve por
> **propiedad de la fila**, no por membresía.

---

## 3 · Decisión

> **D-1 · El buzón pasa a tener dueño por fila.** Cada sobre lleva una **prenda de escritura**
> (`owner_tag`): la huella SHA-256 de un secreto de 32 bytes aleatorios que vive **sólo** en el
> dispositivo que lo publicó, junto a la privada de identidad, y que **nunca se publica ni viaja
> en el sobre**.
>
> **D-2 · Se borra presentando el preimagen, nunca la huella.** Un borrado es una llamada que
> lleva el secreto; el servidor lo hashea y borra las filas cuya `owner_tag` coincide. **Conocer
> `owner_tag` no habilita nada** — es un hash, y el buzón nunca ve el secreto salvo en el
> instante de la llamada.
>
> **D-3 · La compactación deja de operar por `sender` y pasa a operar por prenda.** El `sender`
> declarado deja de tener consecuencias: vuelve a ser lo que `001_mailbox.sql:32-34` siempre dijo
> que era, *«sólo para que el receptor no se procese a sí mismo»*.
>
> **D-4 · `sender` no se toca, no se autentica y no se usa para nada que importe.** Sigue siendo
> el filtro de `fetchSince` (`relay.ts:189`) y nada más.

### 3.1 · Por qué esto NO contradice a ADR-003

ADR-003 descartó, textual: *«**Grants firmados verificados en el servidor para entrar a un topic**
(pgsodium / edge function): DESCARTADA para MVP. La rotación de topic por época (§1.4) logra la
revocación efectiva **sin criptografía del lado del servidor**. Menos piezas, y la
confidencialidad nunca queda apoyada en que el relay se porte bien.»*
(`engram/02_architecture.md`, §Alternativas descartadas del ADR-003.)

Los dos fundamentos de ese descarte son **menos piezas** y **la confidencialidad no se apoya en el
relay**. D-1/D-2 respeta los dos:

- **Confidencialidad: intacta.** El sobre sigue sellado con `GK` (`envelopeCrypto.ts`), el relay
  sigue sin poder abrirlo, y nada de lo que se decide acá cambia quién puede leer qué. Lo único
  que el servidor gana es la capacidad de decir *«esta llamada trae el preimagen de este hash»*.
- **Piezas: una columna, dos triggers y una función.** No hay `pgsodium`, no hay edge function, no
  hay extensión nueva — `pgcrypto` ya está (`001_mailbox.sql:15`). Comparar un SHA-256 es lo que
  hace cualquier tabla de contraseñas; no es verificar una firma para conceder acceso a un topic,
  que es lo que ADR-003 descartó.
- Y el propio ADR-003 ya había puesto esta capa donde este ADR la deja: *«**El RLS es control de
  abuso, no de confidencialidad** — la confidencialidad la da el sobre»*
  (`02_architecture.md`, §Elección del intermediario). **Poner llave al borrado es exactamente
  control de abuso.**

**Lo que sí se enmienda de ADR-003 y hay que decirlo de frente:** el invariante de retención
*«nadie borra sobres, sólo los expira la purga»* (`001_mailbox.sql:75-76`) **se retira**. Se
reemplaza por:

> **R-borrado:** *un sobre lo borra la purga, o quien puede probar que lo escribió. Nadie más.*

Enmienda menor en la letra, y estrictamente **más fuerte que la realidad de hoy** (§2.1), donde
lo borra cualquiera que conozca el topic.

### 3.2 · Dónde va la prenda, y la restricción dura que ordena esa elección

**Restricción dura:** `owner_tag` no puede ser un valor que el atacante pueda **replicar en un
INSERT**, porque el INSERT es lo que dispara la compactación. Guardar la huella (no el secreto) es
lo que resuelve esto: quien lee el hash no puede fabricar una fila con ese hash, porque el
servidor lo deriva del preimagen, no lo copia de la fila entrante.

Forma concreta propuesta (**el mecanismo exacto es implementación, la restricción no lo es**):

- Columna `owner_tag text` en `envelopes`, **nullable** (`null` = sobre del formato viejo).
- Columna de tránsito `owner_proof text`, que un trigger **BEFORE INSERT** convierte en
  `owner_tag = encode(digest(owner_proof,'sha256'),'hex')` y **anula antes de que la fila se
  escriba**. Así el secreto no queda almacenado, no entra en la WAL de la fila comprometida y **no
  puede salir por el `postgres_changes` de Realtime**, que emite la fila ya escrita.
- `compact_envelopes()` cambia `sender = new.sender` por
  `owner_tag is not distinct from new.owner_tag` — con `null` el comportamiento queda **idéntico
  al de hoy**, que es lo que hace que un cliente viejo no note nada (§6).
- Función `delete_my_envelopes(p_topic text, p_secret text)`, `security definer`, que borra
  `where topic = p_topic and owner_tag = encode(digest(p_secret,'sha256'),'hex')` y devuelve el
  conteo. **No se agrega política de DELETE**: la RLS sigue negando el borrado directo, y la única
  vía es la función. Menos superficie.

> ⚠️ **No verificado y por eso no se apoya nada en ello:** no pude confirmar contra documentación
> si Supabase Realtime honra los *privilegios a nivel de columna* en `postgres_changes`. **Por eso
> el diseño no usa column grants**: el secreto se anula antes de escribirse, y lo que queda en la
> fila es un hash cuya exposición es inocua. La solución elegida no depende de esa pregunta.

### 3.3 · Qué compra exactamente, en la frase del PO

| lo que pidió el PO | qué queda garantizado |
|---|---|
| «cada usuario puede borrar datos de su propia potestad» | ✅ borra toda fila cuyo secreto tenga — o sea, las que escribió ese dispositivo |
| «un ex-miembro no debería poder borrar datos pertinentes al grupo» | ✅ **y con un argumento que no depende de saber quién es ex-miembro:** lo único que puede borrar es su propia copia. Cada miembro publica el estado **completo** del grupo (`relaySync.ts:103`, regla #8), así que borrar la copia de uno deja M−1 copias completas. Bajo R′ (ADR-007) sigue valiendo: el conjunto de rebanadas de cada emisor cubre todo el grupo, y por eso `ADR-007:…§9` dice que *«el factor M es lo que hoy da robustez ante el riesgo 1»* |
| «sólo el registro propio que tenga» | ✅ es literalmente el predicado del borrado |
| — | ➕ **de regalo, cierra el defecto de §2.1**: al compactar por prenda y no por `sender`, el vector de borrado ajeno que hoy está vivo se cierra |

**Borde declarado:** en un grupo donde esa persona es **el único** que publica, borrar lo suyo
vacía el buzón del topic. No se pierde plata —los datos están en los teléfonos— pero el que entre
después no ve nada hasta que alguien publique. Es el mismo modo de falla que ADR-007 riesgo 4.

---

## 4 · Opciones costeadas

**Los costos son de trabajo relativo, no de calendario.** Ninguna se estimó en horas: no tengo
base para eso y prefiero abstenerme.

### A · Prenda de escritura por dispositivo (la decisión, §3)

| | |
|---|---|
| **Servidor** | 1 columna + 1 columna de tránsito + 1 trigger BEFORE nuevo + 1 trigger AFTER reescrito + 1 índice reescrito + 1 función. Sin extensiones nuevas. **1 migración.** |
| **Cliente** | Generar y guardar el secreto (misma maquinaria que `ensureIdentity`, `identityStore.ts:32-39`); pasarlo en `envelopeRow` (`relay.ts:98-105`); una función `deleteMyEnvelopes(topic)` nueva en `relay.ts`. |
| **Invariante que toca** | El de retención de `001_mailbox.sql:75-76`. Lo reemplaza por uno **más fuerte** que el estado real (§3.1). |
| **Riesgo nuevo que introduce** | Ninguno que yo pueda identificar: sólo puede borrar quien prueba haber escrito. **Neto de seguridad: positivo** — cierra §2.1. |
| **Lo que NO compra, y hay que decirlo** | (i) **Reinstalar o perder el teléfono destruye el secreto** ⇒ esos sobres quedan sin dueño y **sólo los levanta el TTL de 30 días**. Para T-074 esto es un agujero real: quien reinstala y después borra la cuenta no puede purgar lo que publicó la instalación anterior. (ii) **Multi-dispositivo:** el teléfono A no borra los sobres del teléfono B. Compartir el secreto entre dispositivos exigiría sincronizar un secreto, y el proyecto se negó a eso a propósito para las privadas (`identityStore.ts:5-11`). (iii) No frena que un ex-miembro **siga publicando**: eso es rotación de época, que no existe (§2.2b) y no entra acá. |

### B · Propiedad por sesión de Supabase (`auth.uid()`)

| | |
|---|---|
| **Cómo** | Columna `owner uuid default auth.uid()`; política de DELETE `using (owner = auth.uid())`; compactación por `owner`. |
| **Precedente real, ya en producción** | Es **exactamente** lo que hace `device_keys`: `owner uuid not null default auth.uid()` (`003_device_keys.sql:18`) con política de borrado `using (owner = auth.uid())` (`003_device_keys.sql:62-65`). Y la app **ya se loguea contra Supabase** con el mismo `id_token` de Google/Apple, sin una segunda pantalla ni un segundo consentimiento (`src/sync/directoryAuth.ts:23-42`). |
| **Lo que compra y A no** | La propiedad sigue a la **cuenta**, no al aparato. Reinstalación, segundo teléfono y borrado de cuenta pasan a poder purgar. Es lo que la frase del PO dice literalmente. |
| **Costo 1 — técnico, y es serio** | `relay.ts:81` fija `auth: { persistSession: false }`, con el comentario *«la identidad la maneja la app, no Supabase»*. La sesión vive en memoria y muere con el proceso. Pero se publica desde `relayEngine` con debounce de 1,5 s y poll de 20 s (`relayEngine.ts:62,65`), sin ningún login interactivo de por medio ⇒ **`auth.uid()` sería NULL en la mayoría de los INSERT, y esas filas quedarían imborrables para siempre.** Arreglarlo obliga a persistir la sesión (un refresh token guardado en el aparato) o a reloguear en cada arranque: modos de falla nuevos y una credencial almacenada que el proyecto evitó. |
| **Costo 2 — de privacidad, y NO lo decido yo** | Hoy el relay ve `topic` (opaco) ↔ `sender` (un `Math.random()`). Con `owner uuid`, **el relay puede unir `envelopes.owner` con `auth.users` y con `device_keys.owner` (`003_device_keys.sql:18`) y pasar de un grafo social seudónimo a uno nominativo, con mail, en una sola consulta.** El PO aceptó *«IP, horarios y grafo social»* (P-3, `02_architecture.md:573`) — pero lo aceptó sobre seudónimos de aparato. Esto es otra exposición. **Es P-14.** |
| **Costo 3** | Ambas políticas son `to anon` hoy (`001_mailbox.sql:67,72`). Exigir sesión para insertar rompe que la app funcione sin cuenta de Supabase; no exigirla reintroduce el costo 1. |

### C · Verificar la firma Ed25519 en el servidor

| | |
|---|---|
| **Cómo** | El sobre ya lleva pública `k` y firma `s` (`envelopeSign.ts:48-53`): una función podría parsear y verificar. |
| **Por qué se descarta, y es la única que sí contradice ADR-003** | `pgcrypto` **no tiene Ed25519**; haría falta `pgsodium` o una edge function — **verbatim la alternativa que ADR-003 descartó**. Suma ops y superficie de deploy a un equipo de una persona, que es el mismo criterio con el que se descartó el relay propio en VPS y Firebase. |
| **Y lo decisivo** | Compraría **la misma propiedad que A** — la clave de firma también es del aparato y también se pierde al reinstalar (`identityStore.ts:5-11`) — **a un costo mucho mayor y rompiendo un ADR.** No hay canje: es peor en las dos dimensiones. |

### D · Borrado lógico por republicación (retracción)

| | |
|---|---|
| **Cómo** | Republicar una rebanada vacía con la misma `ckey`; el trigger de compactación borra la anterior. Cero cambios de servidor **una vez que ADR-007 esté implementado**. |
| **Por qué no alcanza** | (i) No sirve para T-074 tras una reinstalación: sin el registro local `ckey → cuándo la publiqué` (`ADR-007:§3.4`) no se sabe qué retractar. (ii) La retracción **queda ella misma** en el buzón 30 días. (iii) Se apoya justamente en la compactación que §2.1 muestra falsificable ⇒ sin A, es una puerta que el atacante usa mejor que el dueño. |
| **Veredicto** | **Complemento útil, no solución.** Vale como el camino «saco mi contenido» que no cuesta servidor, y encaja con la regla #1 (nunca DELETE físico, siempre un registro que gana por merge). No satisface lo que pidió el PO. |

### Recomendación técnica

**A ahora; B como mejora, sólo si el PO acepta el costo 2 de privacidad (P-14).**
**A y B componen**: pueden convivir las dos columnas y permitir el borrado si coincide
*cualquiera* de las dos, lo que le da recuperación a nivel cuenta al que tiene sesión y a nivel
aparato a todos los demás. Eso es la salida del agujero de reinstalación de A, sin apostar a B hoy.

---

## 5 · La contradicción aparte: «arranca desde 0» contra P-2

El PO ya decidió el reingreso el 2026-09-04: *«El que vuelve a un grupo arranca de cero»*, con la
consecuencia anotada *«abre una pregunta que S7 tiene que cerrar: qué pasa con las deudas que
tenía de antes»* (`engram/09_plan_lanzamiento.md:310`). P-2 decía lo contrario: *«Todo el
historial del grupo»* (`engram/02_architecture.md:575`).

**Tres cosas técnicas, antes de que nadie decida nada:**

**1 · «Arranca de cero» no se puede imponer sobre el que se fue, y nunca se pudo.**
Conserva `GK` y el topic (§2.2b) y conserva su copia local. ADR-003 ya lo declaró irreducible.
Lo único que el grupo puede hacer es **dejar de re-enseñarle** la historia — no puede hacer que la
olvide. Que la olvide de verdad exige que **su propio dispositivo purgue el grupo al salir**, que
es un cambio de cliente, no de relay.

**2 · Y si no purga, hay un vector de resurrección real.**
`mergeByIdLWW` es **una unión, nunca una resta** (`src/store/lww.ts:59-72`) y `applyDelta` tolera
listas ausentes (`useSyncQR.ts:137-141`). Si el que vuelve **publica antes de drenar**, su copia
vieja se une a la del grupo y **puede resucitar registros borrados** — la misma clase que el
riesgo 3 de ADR-007. Regla de implementación que sale de esto, y es barata:

> **Al reingresar, el dispositivo no publica nada de ese grupo hasta haber drenado el buzón al
> menos una vez.** Publicar antes de drenar es lo que convierte una copia vieja en una
> resurrección.

**3 · La sorpresa incómoda: bajo el diseño actual, «arranca de cero» y «ve todo el historial»
producen casi el mismo resultado observable.**
Cada miembro publica el **estado completo** del grupo (`relaySync.ts:103`, regla #8) y el merge es
una unión. Así que el que vuelve, aunque llegue con la memoria en blanco, **vuelve a ver todas sus
deudas viejas en el primer drenaje** — se las re-enseñan los otros. La diferencia entre las dos
opciones no es *qué ve*, es *de qué dispositivo salió*.

Para que «arranca de cero» **borre la historia de verdad**, el grupo tendría que dejar de publicar
los registros de esa persona. Eso es **borrar la prueba de la deuda de otro**, que es exactamente
lo que T-074 §1 se niega a hacer: *«los gastos que involucran a esta persona son la prueba de una
deuda de otro. Borrarlos rompería los balances de gente que no pidió nada»*
(`engram/plans/T-074.md:20-22`).

> **Por eso no hay «dos verdades sobre quién le debe a quién».** El temor del encargo no se
> materializa: el que vuelve no tiene con qué contradecir al grupo, y el grupo gana por
> construcción. Lo que sí queda es un problema de **honestidad de la interfaz** — al reingresado
> le aparecen deudas que su app nunca le mostró, sin explicación. Eso es copy, no arquitectura.

---

## 6 · Lo que exige del servidor — MIGRACIÓN QUE APLICA EL PO A MANO, SOBRE DATOS VIVOS

Un archivo. **Ninguna fila se borra ni se reescribe; ninguna columna existente cambia de tipo.**
Se numera después de la de ADR-007, cuando ésa exista.

| cambio | detalle |
|---|---|
| **2 columnas nuevas** | `owner_tag text` **nullable** (`null` = sobre viejo) y `owner_proof text` **nullable**, de tránsito. |
| **1 trigger nuevo** | BEFORE INSERT: `owner_tag := encode(digest(owner_proof,'sha256'),'hex')` y `owner_proof := null`. Sin `owner_proof` no hace nada ⇒ el cliente viejo inserta como hoy. |
| **1 trigger reescrito** | `compact_envelopes()`: `sender = new.sender` → `owner_tag is not distinct from new.owner_tag`. **Con `null` el comportamiento queda idéntico al actual.** |
| **1 índice reescrito** | `envelopes_compact_idx` pasa de `(topic, sender, seq)` a `(topic, owner_tag, seq) where compactable`. Sin esto cada inserción escanea la tabla (`004_compaction.sql:60-63`). |
| **1 función nueva** | `delete_my_envelopes(p_topic text, p_secret text)`, `security definer`, `search_path = public`. |
| **0 políticas de RLS nuevas** | Sin política de DELETE: se sigue negando el borrado directo. La lectura sigue `using(true)` — `owner_tag` es un hash y exponerlo es inocuo (§3.2). |
| **0 cambios de tamaño** | El `CHECK` de 1.048.576 y la política de INSERT quedan como están (`006_payload_limit.sql:37-49`). |

**Compatibilidad — sin día de corte, con una advertencia:**

| publica | resultado |
|---|---|
| cliente viejo (sin `owner_proof`) | `owner_tag` queda `null`; compacta por `null`, o sea como hoy |
| cliente nuevo | compacta por prenda; puede borrar lo suyo |
| **el mismo aparato, antes y después de actualizar** | ⚠️ sus sobres pre-actualización tienen `owner_tag null` y **no se compactan contra los nuevos**: quedan como una fila huérfana por topic **hasta el TTL**. Una fila de más durante ≤30 días. Aceptable, y se declara. |

**Orden de despliegue — importa, y por el mismo motivo que en ADR-007 §5: PRIMERO la migración,
DESPUÉS la app.** Al revés, un cliente que manda `owner_proof` contra un servidor sin la columna
recibe un error de PostgREST y **deja de publicar**.

**Verificación después de correrla** (una fila cada una):
```sql
select column_name from information_schema.columns
 where table_name='envelopes' and column_name in ('owner_tag','owner_proof');
-- Y la que importa de verdad: que el secreto NO se guarda.
select count(*) from public.envelopes where owner_proof is not null;  -- tiene que dar 0
```

---

## 7 · Riesgos

1. **El secreto se pierde con la reinstalación.** Es el límite duro de A (§4). Para T-074 significa
   que el borrado de cuenta **no puede prometer** purgar lo publicado por instalaciones
   anteriores. La política de privacidad ya dice la verdad que cubre esto —*«lo que quedó en el
   buzón se borra solo en 30 días»* (`engram/plans/T-074.md:59-62`)— y ahora es cierto de verdad,
   porque el cron existe (`007_ttl_cron.sql:31-35`). **Ningún texto debe prometer más que eso.**
2. **El borrado es irreversible y no tiene confirmación del lado del servidor.** Si `T-074` llama a
   `delete_my_envelopes` antes de destruir las claves y la red falla en el medio, quedan sobres.
   El orden que T-074 §4 ya fija —*anunciar → confirmar entrega → borrar*— hay que extenderlo:
   **purgar el buzón antes de destruir el secreto**, o el secreto se pierde y los sobres quedan
   hasta el TTL.
3. **`owner_proof` es una columna que contiene un secreto durante la ejecución del INSERT.** Si el
   trigger BEFORE se desactiva o se rompe, el secreto **se persiste en claro y sale por Realtime**.
   Es un modo de falla silencioso. **Mitigación obligatoria:** la verificación de §6
   (`count(*) where owner_proof is not null` = 0) tiene que ser parte del cierre del ticket, no una
   sugerencia. *(Alternativa más segura y más cara: hacer el INSERT por una función `security
   definer` y no exponer la columna nunca. Se anota; no la elijo por el costo sobre el camino
   caliente de `sendEnvelope`.)*
4. **Esto no frena a un miembro malicioso que publica basura firmada**: sigue siendo T-041, y este
   ADR no lo toca.
5. **Un grupo de un solo publicador que borra lo suyo deja el buzón vacío** (§3.3).

---

## 8 · Preguntas para el PO (P-3 — no las decide el arquitecto)

- **P-14 · ¿Se acepta que el relay pase a ver un grafo social NOMINATIVO?** Es el precio de la
  opción B, y B es lo único que hace que el borrado de cuenta funcione después de una
  reinstalación o desde un segundo teléfono. Hoy el relay ve seudónimos de aparato; con B puede
  unir sobres ↔ cuenta ↔ mail con una consulta (§4·B costo 2). Aceptaste el grafo social en P-3;
  esto es un escalón más. **Recomendación técnica: A sola para publicar, y B después si el
  borrado-tras-reinstalación aparece como queja real.** No la elijo yo.
- **P-15 · ¿Qué dice la app cuando el borrado de cuenta no puede purgar todo?** El caso es
  «reinstalaste, y lo de antes se va solo en 30 días». Opciones: (a) decirlo en la pantalla de
  confirmación; (b) decirlo sólo en la política de privacidad; (c) no decirlo. **Recomendación
  técnica: (a)** — es el mismo criterio de honestidad de T-074 §1, y prometer de más es lo caro
  ante las tiendas.
- **P-16 · «Arranca desde 0»: ¿cuál de las dos?** (a) **el dispositivo del que vuelve olvida y
  re-aprende del grupo** — barato, seguro, y en la práctica el reingresado termina viendo sus
  deudas igual (§5·3); (b) **el grupo también lo olvida** — implica borrar la prueba de la deuda de
  otros y romper balances de gente que no pidió nada (`T-074.md:20-22`). **Recomendación técnica:
  (a), y decir el (b) en voz alta para que quede descartado a conciencia.** Es plata: no la decido.
- **P-17 · Al reingresado le van a aparecer deudas viejas que su app nunca le mostró.** ¿Se le
  explica («volviste a este grupo; esto es lo que el grupo recuerda de antes») o aparecen sin
  aviso? Es copy y fricción, no arquitectura.

---

## 9 · Alternativas descartadas

| alternativa | por qué no |
|---|---|
| **Token de escritura derivado de `GK`** | Void contra el atacante del modelo de amenaza, que **tiene `GK`** (`ADR-007:277-278`), y el otro insumo (`sender`) se lee del buzón. Frena sólo a los de afuera, que ya estaban frenados. §2.2a |
| **Verificar la firma Ed25519 en el servidor** | Única opción que contradice ADR-003 de verdad; exige `pgsodium` o edge function; y compra **la misma** propiedad que A, porque la clave de firma también muere con la reinstalación. §4·C |
| **Sólo borrado lógico (retracción)** | No sirve tras una reinstalación, deja la retracción 30 días, y se apoya en la compactación que §2.1 muestra falsificable. Complemento, no solución. §4·D |
| **Aceptarlo declarado (opción (a) de ADR-007 §8 riesgo 1)** | Ya no es «aceptar un riesgo futuro»: §2.1 muestra que el borrado ajeno **está vivo hoy**, y que el docblock que dice lo contrario es incorrecto. Y no desbloquea T-074, que es requisito de tienda. |
| **Autenticar `sender`** | No hay nada que autenticar: es `Math.random()` local (`relayEngine.ts:78-84`) y viaja en claro. Convertirlo en credencial exigiría que dejara de ser legible, y es el filtro de `fetchSince` (`relay.ts:189`). Se deja como está, sin consecuencias — que es lo que `001_mailbox.sql:32-34` siempre dijo. |
| **Privilegios a nivel de columna para ocultar la prenda** | Se apoyaría en que Realtime honre column grants en `postgres_changes`, **cosa que no pude verificar**. El diseño elegido no necesita esa respuesta. §3.2 |
| **Compartir el secreto entre los dispositivos de una cuenta** | Exige sincronizar un secreto entre aparatos, que es exactamente lo que el proyecto se negó a hacer con las privadas (`identityStore.ts:5-11`). Si se quiere propiedad a nivel cuenta, el camino honesto es B, no un secreto viajero. |

---

aprobado por · Arquitecto (NERV) · 2026-09-04 · **pendiente de P-14/P-15/P-16/P-17 del PO**

---

## 10 · Estado del arte — cómo lo resuelven otros (2026-09-05)

Búsqueda pedida por el PO tras aprobar este ADR. Detalle y fuentes en
`engram/plans/T-086-investigacion.md`. Tres cosas que tocan decisiones de este documento:

1. **Nadie resolvió «reinstalé y quiero borrar lo mío» sin identidad del lado del servidor.** El
   único que cubre el caso es Signal, con cuenta + PIN humano + **enclaves con conteo de intentos**
   (SVR2). El resto: o tiene identidad de arranque (Matrix redacta apoyado en el homeserver y en el
   dominio del autor; Obsidian Sync exige cuenta), o **sacó el borrado y vive del vencimiento**.
   ⇒ El límite declarado en §7 no es una esquina sin doblar: es donde termina el camino sin
   identidad. Refuerza la recomendación de **P-14: no pagar identidad real por ese caso.**

2. **Tahoe-LAFS ya vivió este defecto exacto** — ticket #1528, CVE-2011-3617:
   *«escalation of authority from knowing a storage index to being able to delete corresponding
   shares»*. Tenían borrado con secreto por share; se filtró; **eliminaron la operación entera** y
   quedaron con expiración de leases: *«las shares se borran cuando ningún cliente renovó su lease
   por más de un mes»*. Un mes — nuestro TTL de 30 días. Es el respaldo externo de §2.1 (la puerta
   está abierta y hay que cerrarla) y de aceptar el TTL como red.

3. **Un motivo técnico más para la prenda por preimagen, y en contra de la firma verificada
   (§4·C):** la forma más limpia del problema en la industria es Nostr — evento de borrado firmado,
   el relay contrasta el pubkey contra el autor de la fila. **Pero eso exige un relay que corra
   código.** El nuestro es una tabla con RLS: comparar un hash contra su preimagen se hace con
   `digest()` de pgcrypto dentro de la policy; verificar Ed25519 no, sin extensión ni edge
   function. La prenda no es sólo la opción barata: **es la única prueba que este sustrato sabe
   chequear.** (Y en Nostr el borrado es explícitamente *no autoritativo* del lado del relay: los
   clientes tienen que validar igual.)

**Fuera del alcance de este ADR, pero lo dejo anotado porque la búsqueda lo puso en evidencia:**
con `groupKeyStore.ts:54` clavado en `epoch: 1`, un ex-miembro conserva topic y clave para siempre.
Eso es lo que convierte a «cualquiera con el topic» en un atacante realista. La referencia de qué
debería significar sacar a alguien de un grupo es **MLS (RFC 9420)**: épocas, forward secrecy,
post-compromise security. Ticket propio, después de la beta.
