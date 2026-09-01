# ADR-008 · Una persona, varios ids: alias de identidad tras fusionar cuentas

**Estado:** PROPUESTO — pendiente de decisión del PO
**Origen:** T-048 (`engram/03_backlog.md:375` y el análisis del Orquestador en `:392`)
**Depende de / enmienda:** ADR-004 (identidad por cuenta) · T-041 (firma por autor, `engram/plans/T-041.md`)
**Regla:** cada afirmación sobre el código lleva `archivo:línea` verificado contra el árbol de
`feature/T-049-conversion-monedas`. Cada número está **medido**, con el arné en §8.

---

## 0 · Resumen ejecutivo

**Recomendación en una línea:** adoptar alias, **pero no como `esYo()` en los sitios de
comparación** —eso es medible y demostrablemente *peor* que el estado actual (§4)— sino como
**canonicalización en un borde único de lectura**, con el conjunto de alias persistido aparte
(no derivado de `acct::merged_scopes`, que se vacía a los 30 días, §5), y **resuelto dentro del
§QUÉ de T-041**, porque la parte que hoy pierde plata está en la firma al escribir, no en las
pantallas (§7).

Y antes que todo eso: **el defecto que hace alcanzable a T-048 es de una línea** y está en
`app/auth/index.tsx:76` (§3). Vale la pena arreglarlo aunque el PO decida no hacer alias.

---

## 1 · El defecto, y qué parte del ticket es cierta

`mergeAccountData` mueve registros por `{id, updatedAt}` (`src/store/mergeAccountData.ts:21`,
`:40-48`) y **no toca ningún campo de identidad**. Verificado por medición, no por lectura:

```
M1  paidById tras fusionar = apple:000123.abc | createdById = apple:000123.abc
    | splits[0].userId = apple:000123.abc          (destino = google:11887766)
```

El resto de la cadena que describe el ticket también es cierto: el dashboard saltea todo grupo
donde no está el id activo (`src/store/selectors.ts:105` y `:155`), la lista de grupos también
(`app/(tabs)/groups.tsx:51`), y la suscripción de sync también
(`src/sync/relayEngine.ts:86-93`). La pantalla de grupo filtra por `groupId` y por eso los
gastos se siguen viendo (`app/groups/[id].tsx`).

**Lo que el ticket dice y NO es cierto:**

| Afirmación del backlog | Qué encontré |
|---|---|
| «hay **20+ sitios**» | Son **94**, en **39 archivos** (§2). Un plan dimensionado sobre 20 está mal por 4,7×. |
| `selectors.ts:106` | Línea en blanco. El sitio real es **`selectors.ts:105`**. |
| `selectors.ts:180` | Línea en blanco. Los sitios reales son **`:155`, `:184`, `:187`, `:243`**. |
| `groups.tsx:42` | Es `groupTotals.map(...)`. El sitio real es **`app/(tabs)/groups.tsx:51`**. |
| `activity.tsx:159` | Es `</View>`. Los sitios reales son **`app/(tabs)/activity.tsx:289` y `:391`**. |
| `expense/[id].tsx:89,190,191` | Son comentarios. Los sitios reales son **`:122`, `:249`, `:264`, `:265`, `:360`**. |
| `groups/[id].tsx:330,414` | `<View>` y una llamada a `applyApprovedLeaves()`. |
| `groups/[id].tsx:395` | **Correcta.** |
| `relayEngine.ts:91` | Es la línea del `.filter(...)`; el sitio empieza en **`:86`**. |
| `inviteEngine.ts:134` | **Correcta.** |

Nueve de once referencias quedaron corridas. El inventario del ticket no sirve como base de
un plan; el de §2 sí.

---

## 2 · El alcance real, y la clasificación que decide el diseño

**94 comparaciones de identidad en 39 archivos.** Reproducible:

```bash
grep -rn -E "paidById|createdById|authorId|memberIds|fromUserId|toUserId|requestedBy|approvedBy|\.userId" \
  --include="*.ts" --include="*.tsx" src app \
  | grep -vE "__tests__|\.test\." \
  | grep -E "===|!==|includes\(|\.has\(|find\(|filter\(|some\(|every\(" \
  | grep -vE ": *\*|: *//"
```

Contar los sitios no es lo útil. **Lo útil es que no son todos la misma pregunta**, y tratarlos
igual es exactamente el error que hace que la propuesta ingenua rompa plata. Son tres clases:

### Clase A · «¿esto es mío?» — presentación y autoría local (≈ 55 sitios)

`app/expense/[id].tsx:122` (`isCreator`), `:249`, `:264`, `:265`, `:360`;
`app/(tabs)/activity.tsx:289`, `:391`; `app/groups/[id].tsx:384`, `:388`, `:395`, `:405`, `:436`,
`:469`, `:486`, `:613`, `:614`, `:670`, `:671`; `src/components/CommentThread.tsx:69`;
`app/groups/leave.tsx:217-218`; `app/settle/new.tsx:404`; `src/services/syncNotices.ts:93`,
`:100`, `:133-134`.

Booleanos sobre el usuario local. **Nunca salen del dispositivo.** Acá `esYo(id)` es correcto y
suficiente.

### Clase B · «¿quiénes son las partes de este saldo?» — aritmética (≈ 25 sitios)

`src/algorithms/calculateBalances.ts:41-58` (el mapa `totals`), `simplifyDebts.ts:14-50`,
`globalBalances.ts:46,48,66,68`, `absorbBalance.ts`, `repartoSaldo.ts:28,32`,
`settleSuggestion.ts:27-28`, `canLeaveGroup.ts:23-31`, `leaveRequest.ts:56`,
`directedDebts.ts`, `selectors.ts:105`, `:155`, `:184`, `:187`, `:243`, `app/(tabs)/index.tsx:92`.

Acá la pregunta **no es un booleano**. Es *qué nodos entran al grafo de deudas*. Reemplazar
`===` por `esYo()` en esta clase **no arregla nada y rompe plata** (§4).

### Clase C · «¿con qué identidad escribo, firmo y publico?» (≈ 14 sitios)

`src/sync/signOnWrite.ts:57-60` (`esMio`), `deviceKeys.ts:44,54` (registro de clave),
`relayEngine.ts:86-93`, `:117`, `relaySync.ts:45,57,85-89`, `inviteEngine.ts:128`, `:134`,
`:177`, `contactChannel.ts:217`, `:253`, `useSyncQR.ts:57`, `:134`.

Acá la respuesta correcta es **siempre el id ACTIVO, nunca un alias** — salvo una excepción
crítica (`signOnWrite.ts:57`, §7) donde hoy se pierde el trabajo del usuario.

**La decisión que ordena todo el ADR:** las tres clases necesitan tres respuestas distintas.
La propuesta del Orquestador («los ~20 sitios pasan a preguntar `esYo(x)`») aplica la respuesta
de la clase A a las tres.

---

## 3 · Hallazgo no previsto: por qué T-048 es alcanzable, y por qué es de una línea

El backlog dice que T-048 «muerde a cualquiera que enlace cuentas con historia». **Seguí el flujo
de enlace entero y ese enunciado es más angosto de lo que parece, de una forma que importa.**

Las dos rutas de fusión pasan por `resolveAccount` (`src/utils/accountIdentity.ts:73`):

- ruta `linked` (`:91-97`) → `mergeAccounts(previousAccountId, accountId)` (`authStore.ts:139`);
- ruta `confirm` (`:120-122`) → `confirmLink` (`:143`) → `mergeAccounts` (`authStore.ts:146`).

En las dos, **el scope absorbido es el `providerId` del login que está llegando**, y el que
sobrevive es una cuenta que el device ya conocía. Para que el absorbido tenga datos, ese
`providerId` tiene que haber sido cuenta propia antes. Pero el paso 1 de `resolveAccount`
(`:82-88`) hace cortocircuito: si un proveedor ya tuvo cuenta, `index.link(providerId,
providerId, …)` (`:126`) dejó `acct::p:<providerId>` escrito (`authStore.ts:66`) y todo login
posterior devuelve `existing`. **Un proveedor con cuenta propia no se vuelve a absorber nunca.**

Salvo por un camino, y existe:

```
app/auth/index.tsx:73-77
  {
    text: t('auth.link_separate'),
    style: 'cancel',
    onPress: () => onResolved(providerId), // cuenta propia
  },
```

Cuando el usuario elige **«mantener cuenta separada»**, la app entra con `accountId =
providerId` y crea datos bajo ese scope — pero **nadie llama a `index.link()`**. `acct::p:<providerId>`
queda sin escribir. Consecuencias, las dos verificadas contra `accountIdentity.ts`:

1. **Al usuario se le vuelve a preguntar en cada login** (paso 1 falla siempre).
2. **En algún login posterior, ese scope —que ahora SÍ tiene grupos y gastos— se absorbe**: por
   `linked` si para entonces hay un `acct::e:<mail>` apuntando a otra cuenta (`:92-96`), o por
   `confirm` si esta vez el usuario dice que sí (`:120`). Ahí, y sólo ahí, el id que sobrevive no
   es el que está escrito adentro de los registros.

**Esto reencuadra el ticket.** T-048 no es "el precio de enlazar cuentas": es la consecuencia de
un botón que no persiste su propia decisión. Arreglar `app/auth/index.tsx:76` (llamar a
`index.link(providerId, providerId, email)` antes de `onResolved`) cierra la vía de entrada
principal, cuesta una línea, y **no depende de ninguna decisión de este ADR**.

> **No cierra el problema.** Las instalaciones que ya pasaron por ese botón tienen el scope
> huérfano hoy, y el arreglo no las repara retroactivamente. Tampoco cubre un índice de
> identidad perdido por otra vía. Pero cambia la urgencia: sin alias y con esta línea, el
> escenario deja de producirse hacia adelante.

---

## 4 · Por qué el alias en los sitios de comparación es PEOR que no hacer nada

Hoy, un grupo cuyo `memberIds` no contiene el id activo **se saltea entero**
(`selectors.ts:105`, `:155`). La plata queda invisible. Es malo, y es *inerte*: no se corrompe
ningún número.

Si se cambia ese `includes(currentUserId)` por `includes` alias-aware y **no se toca la
aritmética**, el grupo entra al pozo global (`selectors.ts:158-166`) con **el id viejo y el id
nuevo como dos nodos distintos**, porque `calculateBalances` siembra su mapa desde `memberIds`
(`calculateBalances.ts:41`) y acumula por `split.userId` / `payer.userId` (`:50-57`) sin saber
nada de alias. `simplifyDebts` (`simplifyDebts.ts:14`) los empareja como a dos personas
cualesquiera. Medido:

```
M3  balances    = [{"userId":"apple:000123.abc","amount":10000},
                   {"userId":"google:11887766","amount":-6000},
                   {"userId":"google:99999999","amount":0}]
    transacciones = [{"fromUserId":"google:11887766","toUserId":"apple:000123.abc",
                      "amount":6000,"currency":"ARS"}]
```

`fromUserId` es el id activo, así que `selectors.ts:187` lo toma como *«le debo a alguien»* y lo
publica en el dashboard: **«le debés $60 a Gabriel Maglia»** — a uno mismo, con el propio nombre,
porque el perfil del id viejo se mergea como usuario externo (`useSyncQR.ts:134`). Y ese importe
**netea contra deudas reales** en el mismo pozo por moneda (`selectors.ts:176-186`).

Eso es plata inventada donde hoy hay plata escondida. **Es un empeoramiento estricto**, y es la
razón por la que este ADR no puede ratificar la propuesta tal como está escrita.

---

## 5 · El conjunto de alias no tiene, hoy, fuente de verdad

La propuesta del Orquestador dice: *«El enlace ya deja registro (`acct::merged_scopes`); esa
lista es el conjunto de identidades históricas de la misma persona.»* **No lo es**, por tres
razones verificadas en `src/store/accountLink.ts`.

**(a) Se vacía a los 30 días.** `purgeMergedScopes` borra del log las entradas ya purgadas
(`:195`). Medido:

```
M2  alias día 0  = [ 'apple:000123.abc' ]
    purgados     = [ 'apple:000123.abc' ]   alias día 31 = []
```

Un `esYo()` alimentado por ese log **funciona 30 días y después deja de funcionar solo** — y para
entonces los datos del scope de origen también fueron borrados (`:191`), así que no hay de dónde
reconstruirlo. Es el peor modo de falla posible: una regresión silenciosa, diferida un mes, sin
nada que la dispare ni la explique.

**(b) No dice hacia dónde.** Las entradas son `{scope, at}` (`:132`): guardan el absorbido, no el
destino. Con dos fusiones hacia cuentas distintas en el mismo device, la lista no permite decidir
qué alias son de la cuenta activa.

**(c) No está scopeada por cuenta.** `MERGED_LOG = 'acct::merged_scopes'` (`:129`) se lee y
escribe sin sufijo `::u:` (`:135`, `:141`), a diferencia de todo lo demás en ese archivo, que pasa
por `ranura()` (`:75-84`). Es correcto para lo que hace hoy (una agenda de purga del device);
es incorrecto como conjunto de alias de una persona.

**Conclusión:** el conjunto de alias hay que **persistirlo aparte, por cuenta, y de forma
permanente**, escrito en `mergeAccounts()` (`:104-118`) y declarado como `ranura()` para que el
guard de cobertura de fusión (`accountCoverage.test.ts`, ver `COBERTURA_FUSION` en `:497`) lo
cubra solo. Tiene que ser **transitivo**: si A→B y luego B→C, los alias de C son {A, B}.

---

## 6 · El sync: qué cambia y qué no puede cambiar

**Nada de lo que se publica cambia.** Ésa es la propiedad que hace viable el diseño, y también
la que es fácil de romper por accidente.

- `buildDelta` (`src/sync/useSyncQR.ts:53-69`) y `buildGroupPayload` (`src/sync/relaySync.ts:45-73`)
  leen **los stores crudos**. Si la canonicalización se implementa dentro de los stores o en su
  hidratación, **los ids reescritos se publican** — y eso es exactamente la migración destructiva
  que este ADR existe para evitar, sólo que llegando por la puerta de atrás. **Invariante:**
  la canonicalización vive **entre los stores y el modelo de lectura**, nunca debajo. Necesita un
  guard, del mismo tipo que `relayScope.test.ts` y `noHardcodedCurrency.test.ts` ya son.
- `fromUserId` del delta (`relaySync.ts:57`, `useSyncQR.ts:57`) sigue siendo **el id activo**.
  Es quien manda el sobre, no quien escribió los registros; mandar un alias sería mentir sobre el
  cartero y rompería la medición de la fase B de ADR-004 (`relaySync.ts:162`).
- **La suscripción sí necesita alias** (clase C, excepción): `syncableGroupIds`
  (`relayEngine.ts:86-93`) exige `memberIds.includes(userId)`. Sin alias, los grupos históricos
  no se sincronizan aunque tengamos su clave — y la clave la tenemos, porque `mergeGroupKeys`
  la trajo (`accountLink.ts:262-288`). Con alias, se suscriben y publican; el sobre que se
  publica es el estado del grupo tal cual está guardado, sin reescribir nada.
- **El roster (`memberIds`) no se toca.** Publicar un `memberIds` con el id nuevo agregado sería
  un alta de miembro no solicitada en el teléfono del otro. Se canonicaliza **al leerlo**, y sólo
  para calcular; el registro guardado y publicado queda como está.
- `applyDelta` filtra el propio perfil por `u.id !== currentUserId` (`useSyncQR.ts:134`). Con
  alias hay que decidirlo explícitamente: el perfil del id **viejo** llega del peer y hoy se
  adopta como usuario externo. Debe **seguir adoptándose** (es lo que da el nombre para
  renderizar los registros históricos), pero **no debe pisar el perfil propio**. Filtrar por
  `esYo(u.id)` sería tentador y está **mal**: dejaría los registros viejos mostrando un id crudo.

---

## 7 · T-041: qué significa una firma hecha con la identidad vieja

Ésta es la parte que no se puede resolver dos veces por separado, y la respuesta es mejor de lo
que el ticket temía en la lectura, y peor en la escritura.

### 7.1 · Verificar: **funciona, y no hace falta tocarlo**

`createdById` está **adentro** del núcleo firmado (`src/sync/recordCore.ts:72`) y la
verificación resuelve las claves de *ese* id (`recordSign.ts:64-83`, vía `authorKeysFor`,
`authorKeys.ts:303`). La pregunta del handoff era si eso verifica. Medido: **sí.**

```
M4  veredicto antes de editar = valida
```

Y hay una razón estructural, no una casualidad: la clave de firma **es del aparato y no se
scopea por cuenta** (`src/store/identityStore.ts:7-10`), y el directorio resuelve **por persona,
no por proveedor** — `account_keys` une todas las filas que comparten `owner` de Supabase
(`supabase/005_claves_por_owner.sql`). Los dos ids de la misma persona en el mismo teléfono
registran **la misma pública** (`deviceKeys.ts:54`, `ensureIdentity()`), así que
`account_keys(idViejo)` ya la devuelve.

**Corolario:** el alias ya existe del lado de la verificación de firmas, desde ADR-004 fase B, y
funciona sin que nadie se entere del enlace. Un registro firmado con la identidad vieja **cuenta
como `valida`** y no hay que cambiar nada para que siga así.

**Salvo el borde ya declarado de ADR-004**: si Supabase no pudo vincular las dos identidades
(Apple manda `email` sólo en la primera autorización — lo dice el propio `005`), o si la cuenta
vieja nunca registró su clave, `account_keys(idViejo)` viene vacío y el veredicto cae en
`no_verificable` (`recordSign.ts:80`), **que por decisión R1 del PO nunca es un rechazo**. Es
degradación honesta, es el mismo borde que ADR-004 ya asumió, y hay que dejarlo escrito acá para
que no se descubra después.

### 7.2 · Escribir: **acá se pierde trabajo del usuario, hoy, medido**

`signOnWrite.esMio()` compara `authorOf(record) === activeUserId()`
(`src/sync/signOnWrite.ts:57-60`). Tras el enlace, un gasto con `createdById = idViejo`
**deja de ser mío**. Entonces `signOnEdit` (`:143-150`) devuelve el registro **tal cual**: no
re-firma y **no sube `rev`**. Dos consecuencias, las dos medidas:

**(a) La firma válida del autor honesto se convierte en `invalida`.**

```
M4  veredicto tras editar = invalida
```

El núcleo cambió (`amount` es `core`, `recordCore.ts:61`) y `k`/`s` quedaron de la versión
anterior. Por R1 no se rechaza: **se marca**. O sea, la app le pone al usuario una marca de
suplantación **en su propio gasto, por editarlo**. Es exactamente la acusación que T-041 se
diseñó para no producir (`recordSign.ts:76-78`, `signOnWrite.ts:86-89`).

**(b) La edición se puede revertir sola, en silencio.**

`rev` no sube, así que la versión editada y la del peer entran empatadas a `coreWins`
(`mergeLevels.ts:152-160`) y el ganador lo decide una **comparación de strings del núcleo
canónico** — arbitraria, no "el que editó último". El peer republica el estado completo del grupo
cada 20 s (`relayEngine.ts:61`, `POLL_INTERVAL_MS = 20_000`), así que tiene todas las vueltas que
quiera. Barrido sobre 7 ediciones realistas del mismo gasto:

```
M5  sobrevive  · monto 12.000        M5  sobrevive  · nota "con Ana"
    sobrevive  · monto  8.000            sobrevive  · categoria transport
    SE PIERDE  · descripcion "Bar"       sobrevive  · fecha 5.000
    sobrevive  · descripcion "Taxi"
    TOTAL: 1/7 ediciones revertidas en silencio
```

**No leer ese 1/7 como una probabilidad.** El criterio es determinista por contenido: para un
gasto dado, o su edición sobrevive siempre o se pierde siempre. Lo que el barrido demuestra es
que **el conjunto que se pierde no es vacío** y que el usuario no tiene forma de saber en cuál
cayó.

**Por eso T-048 pertenece al §QUÉ de T-041.** `esMio()` tiene que ser alias-aware, y cuando lo
sea, la re-firma es correcta sin reescribir nada: `createdById` sigue siendo el id viejo, `k` es
la clave de este aparato, y el peer la resuelve por `account_keys(idViejo)` (§7.1). El `rev` sube
y la edición gana el merge como corresponde. **Resolverlo en un ticket aparte de T-041 obliga a
razonar dos veces sobre la misma línea y a coordinar dos entregas sobre `signOnWrite.ts`.**

---

## 8 · Qué ve el otro peer

Para él, `idViejo` y `idNuevo` son dos personas, y va a seguir mandando registros con el viejo
por tiempo indefinido. El diseño lo tolera porque **no le exige enterarse de nada**:

- No le llega ningún registro reescrito: la canonicalización es de lectura (§6).
- Sus propios cálculos usan **su** roster y **sus** registros, que no cambiaron. Sus números
  siguen siendo los que eran.
- Un peer viejo, sin actualizar, ve exactamente lo mismo que hoy.

**Lo que sí se le degrada, y hay que decirlo en vez de taparlo:** la misma persona le figura
como **dos contactos con el mismo nombre** (`app/(tabs)/friends.tsx:45` filtra sólo el id activo),
y si esa persona es acreedora bajo un id y deudora bajo el otro, la simplificación del peer puede
emitirle una transferencia **entre las dos mitades de una sola persona** — el mismo mecanismo del
§4, en su teléfono. **No lo podemos arreglar unilateralmente**, y forzarlo violaría la restricción
del handoff.

Hay una salida limpia para eso, y la dejo como **fase 2 opcional, no como requisito** (§10, D):
publicar un registro `aliasDeIdentidad {idViejo, idNuevo}` firmado con la clave del aparato. Es
verificable sin confiar en nadie —el peer comprueba que esa misma pública está en
`account_keys(idViejo)` **y** en `account_keys(idNuevo)`—, es aditivo (quien no lo entiende lo
ignora, igual que `k`/`s` en S5, `signOnWrite.ts:16-19`), y **la corrección nunca depende de que
llegue**. Es la única forma de arreglar la vista del peer, y es opcional por construcción.

---

## 9 · Los balances: qué garantiza que no se dupliquen ni se pierdan

La garantía **no puede venir de comparar mejor**. Tiene que venir de que los dos ids **nunca
lleguen a existir como dos nodos** en el grafo de deudas. Es la diferencia entre `esYo()` y
canonicalizar, y es toda la diferencia.

**Regla:** todo id que entra a la clase B pasa antes por `idCanonico(id)` — que devuelve el id
activo si `id` es un alias mío, y `id` en cualquier otro caso. Los puntos de entrada son
exactamente tres, y son enumerables:

1. `memberIds` al armar el roster de cálculo (`calculateBalances.ts:41`,
   `selectors.ts:158`, `:243`, `directedDebts` en `selectors.ts:105-118`) — **y de-duplicar
   después de canonicalizar**, porque el roster también alimenta el quórum de aprobaciones
   (`canLeaveGroup.ts:23-31`, `hasAllApprovals` en `:34-37`): un miembro contado dos veces cambia
   quién tiene que aprobar una salida.
2. `payer.userId` y `split.userId` al acumular (`calculateBalances.ts:50`, `:55`).
3. `fromUserId` / `toUserId` de los pagos (`calculateBalances.ts:107-108`, `globalBalances.ts:66-68`).

**Por qué esto no puede crear ni destruir plata, y es demostrable en vez de prometible:**
`calculateBalances` es una suma sobre un `Map` (`:47-58`). Colapsar dos claves en una es sumar sus
valores. Entonces **Σ de los balances es invariante bajo la canonicalización**, y como
`simplifyDebts` conserva la suma por construcción (transfiere `min(giver, receiver)` y descuenta
de los dos, `simplifyDebts.ts:43-49`), el total tampoco cambia después de simplificar. Y como los
dos ids se vuelven **una sola clave antes** de que `simplifyDebts` vea el vector, **una
transferencia entre dos alias de la misma persona es aritméticamente imposible**, no
"improbable".

Ése es el test que hay que escribir, y es una **propiedad**, no un ejemplo: para todo conjunto de
gastos y todo particionamiento de un miembro en dos alias, `Σ balances(canonicalizado) ==
Σ balances(sin partir)` y `∄ tx` con `from` y `to` alias del mismo. Un test de dos ejemplos
elegidos a mano acá no prueba nada (playbook §QA).

---

## 10 · Decisión

**Se adopta el alias, con esta forma y no con la propuesta original.**

| | Qué | Dónde |
|---|---|---|
| **D-0** | **`app/auth/index.tsx:76` llama a `index.link(providerId, providerId, email)`** antes de `onResolved`. Cierra la vía de entrada de §3. Independiente del resto: se puede hacer aunque el PO rechace todo lo demás. | `app/auth/index.tsx` |
| **D-1** | **Conjunto de alias persistido, por cuenta, permanente y transitivo.** Escrito en `mergeAccounts()`; declarado con `ranura()` para que el guard de cobertura lo cubra solo. **No derivado de `acct::merged_scopes`** (§5). | `src/store/accountLink.ts`, módulo nuevo |
| **D-2** | **Clase A → `esYo(id)`.** Booleano de presentación. | ≈55 sitios |
| **D-3** | **Clase B → `idCanonico(id)` en los 3 puntos de entrada del §9**, no en los sitios de comparación. Con de-duplicación del roster. | `calculateBalances`, `selectors`, `globalBalances` |
| **D-4** | **Clase C → id activo siempre**, con **una excepción**: `signOnWrite.esMio()` pasa a `esYo(authorOf(...))` (§7.2), y `syncableGroupIds` a alias-aware (§6). `fromUserId`, el registro de clave y el roster publicado **no se tocan**. | `signOnWrite.ts:57`, `relayEngine.ts:86` |
| **D-5** | **Invariante con guard: la canonicalización no puede alcanzar `buildDelta` / `buildGroupPayload`.** Un test del grafo de imports, como `relayScope.test.ts`. Sin este guard, D-3 se convierte en la migración destructiva. | test nuevo |
| **D-6** | **Ningún registro se reescribe. Nunca.** | invariante |

**Fase 2, opcional y gateada por medición:** el registro `aliasDeIdentidad` firmado del §8, para
arreglar la vista del peer. No entra en esta entrega.

---

## 11 · Alternativas descartadas

**A · Reescribir los ids adentro de los registros (el «fix obvio»).**
Descartada. La razón del backlog es correcta (propaga por LWW a devices que nunca supieron del
enlace) y hay **una segunda, decisiva, que el backlog no tenía**: `createdById` está **dentro
del núcleo firmado** (`recordCore.ts:72`). Reescribirlo **rompe la firma de todos los registros
reescritos por construcción**, y volver a firmarlos con la identidad nueva produce, para el peer,
exactamente la forma de un registro cuya autoría fue reasignada por un tercero — indistinguible
de la suplantación que T-041 existe para detectar. La reescritura no es sólo destructiva sobre
datos compartidos: es **incompatible con T-041**, que ya está en el árbol.

**B · `esYo()` en los ~20 (94) sitios de comparación, sin tocar la aritmética** — la propuesta
tal como está escrita en el backlog. **Descartada por medición**: produce una deuda con uno mismo
que netea contra deudas reales (§4, M3). Es un empeoramiento estricto sobre el estado actual, que
es inerte.

**C · Derivar el conjunto de alias de `acct::merged_scopes`.** Descartada por medición: se vacía
a los 30 días (§5, M2), no registra el destino, y no está scopeada por cuenta.

**D · Reescribir sólo campos "locales".** Descartada: no existe tal campo. Los seis campos de
identidad (`paidById`, `createdById`, `memberIds`, `splits[].userId`, `fromUserId`, `toUserId`)
viven todos dentro de registros que sincronizan, y cinco de los seis están dentro del núcleo
firmado (`recordCore.ts:58-106`).

**E · Prohibir la fusión cuando el scope de origen tiene datos** — negarse a enlazar y decírselo
al usuario. **No la descarto: se la presento al PO como la opción de mínimo riesgo** (§12). Es
honesta, cuesta poco, no toca plata ni firmas, y deja al usuario con dos cuentas separadas y
visibles en vez de una cuenta con historia mutilada. Su costo es que el problema del PO —"entré
con Google y con Apple y quiero una sola cuenta"— queda sin resolver para quien ya tiene historia.

**F · Migrar sólo local y no publicar hasta que todos los peers actualicen.** Descartada: no hay
servidor que sepa quién actualizó, no hay forma de esperar a un peer que puede no volver nunca, y
el estado intermedio (local reescrito, publicado sin reescribir) es el peor de los dos.

---

## 12 · Riesgos, y qué corrompe datos si sale mal

| Riesgo | Qué pasa si sale mal | Mitigación |
|---|---|---|
| **La canonicalización se filtra a `buildDelta`** | Es la migración destructiva del §11-A, ejecutándose sin que nadie la haya decidido. **Corrompe datos ajenos y es irreversible.** | D-5: guard del grafo de imports. **Es el riesgo #1 y el único que justifica frenar la entrega si el guard no está.** |
| **Dos personas distintas colapsadas en un alias** | Se suman los saldos de dos personas reales. **Corrompe plata, y en la dirección que nadie audita.** | El conjunto de alias sólo se escribe en `mergeAccounts()`, que ya exige confirmación explícita del usuario cuando no hay match de mail (`accountIdentity.ts:120`). Ningún otro camino puede agregar un alias. |
| **El conjunto de alias se pierde** | Regresión silenciosa al estado actual (plata invisible), diferida en el tiempo. | D-1: ranura propia + cobertura del guard de fusión. Es exactamente el modo de falla que §5(a) mide. |
| **Alias no transitivo (A→B→C)** | Los registros de A quedan huérfanos tras la segunda fusión. Mismo síntoma que T-048, dos enlaces después. | D-1 exige transitividad, con test. |
| **Roster canonicalizado sin de-duplicar** | Cambia el quórum de `hasAllApprovals` (`canLeaveGroup.ts:34`): una salida de grupo se aprueba con menos gente de la debida. | §9, punto 1. |
| **`esMio()` alias-aware re-firma registros de otro** | Si el conjunto de alias estuviera mal, se firmaría autoría ajena — lo que `signOnWrite.ts:23-24` prohíbe explícitamente. | Es consecuencia del riesgo 2, no uno propio. Mismo control. |
| **El peer ve una transferencia entre dos mitades de una persona** | Sugerencia de saldo incorrecta en el teléfono del otro. No corrompe sus saldos, sí su pantalla. | Asumido (§8). Sólo lo cierra la fase 2. |

---

## 13 · Qué se mide o se verifica ANTES de implementar

El arné de §14 ya cubre M1-M5. Falta esto, y sin esto el §CÓMO no debería empezar:

1. **Confirmar la vía de entrada del §3 en el device del PO.** `app/debug/identity.tsx` ya muestra
   `identitySnapshot()` (`authStore.ts:78-84`), que expone `known` y la cuenta activa **pero no
   `acct::p:<providerId>`**. Agregar esa fila al diagnóstico es de una línea y responde
   directamente: *¿hay en este teléfono un scope con datos y sin entrada de proveedor?* Es la
   diferencia entre arreglar un defecto real y arreglar uno hipotético.
2. **Contar los alias reales.** Cuántas entradas tiene hoy `acct::merged_scopes` en el device del
   PO, y si alguna ya pasó los 30 días. Decide si hay algo que reparar retroactivamente o sólo
   algo que prevenir.
3. **El test de propiedad del §9** (Σ invariante, ∄ auto-transferencia), escrito **antes** del
   fix y fallando por la razón correcta. Con prueba de mutación (playbook §QA): sacar la
   canonicalización tiene que ponerlo en rojo.
4. **El guard de D-5**, verificado reintroduciendo el import a propósito — como se verificó
   `noHardcodedCurrency.test.ts` (`engram/03_backlog.md:386`).
5. **Costo de `idCanonico` en el camino caliente.** Se llama por split y por pago dentro de
   `calculateBalances`, que corre por grupo y por moneda en cada render del dashboard. Con un
   `Set` de ≤ 3 alias debería ser ruido, **pero este proyecto ya pagó caro un número estimado**
   (674 µs de un README contra 37-58 ms medidos en el device, `mergeLevels.ts:36`). **Medirlo con
   el conjunto de gastos real del PO antes de declararlo gratis.** Si no se mide, no se afirma.

---

## 14 · El arné de medición

Todos los números de este ADR salen de un arné que se corrió sobre el árbol de
`feature/T-049-conversion-monedas` y **se borró después de medir** (no queda como test de
regresión: caracteriza el defecto, así que se pondría en rojo justo cuando el fix funcione).
Se reproduce creando `src/__tests__/T048_harness.test.ts` y corriendo
`npx jest --testPathPattern=T048_harness`:

- **M1** — `mergeAccounts(VIEJO, NUEVO)` sobre un gasto y leer `paidById`/`createdById`/`splits[0].userId` del scope destino.
- **M2** — `mergeAccounts` y luego `purgeMergedScopes(Date.now() + (MERGE_GRACE_DAYS + 1) * 86_400_000)` con la sesión activa en `NUEVO`; leer `acct::merged_scopes` antes y después.
- **M3** — `calculateBalances` con `[VIEJO, NUEVO, OTRO]` donde VIEJO es acreedor y NUEVO deudor, y `simplifyDebts` sobre el resultado.
- **M4** — `signCore` sobre un gasto, `verifyCore`; después mutar `amount` **sin** re-firmar (que es lo que hace `signOnEdit` cuando `esMio()` es falso) y `verifyCore` de nuevo.
- **M5** — `coreWins(peerViejo, miEdicion)` sobre 7 ediciones realistas del mismo gasto, con `rev` empatado.

---

## 15 · Lo que necesita decidir el PO

1. **¿Alias, o negarse a fusionar historia (opción E)?** Alias resuelve el caso real y toca
   la aritmética de saldos y la firma. La opción E no toca ni plata ni firmas y deja al usuario
   con dos cuentas separadas. **Es una decisión de riesgo, no técnica.**
2. **¿D-0 va ya, suelto?** Es una línea, cierra la vía de entrada principal y no depende de 1.
3. **¿T-048 entra al §QUÉ de T-041 o va aparte?** Recomendación: **entra** (§7.2) — la parte que
   pierde trabajo del usuario está en `signOnWrite.ts:57`, que es código de T-041.
4. **¿Fase 2 (el registro `aliasDeIdentidad` del §8) entra al alcance o queda como ticket
   futuro?** Es lo único que arregla la vista del peer. Recomendación: ticket futuro, gateado por
   cuánta gente enlaza cuentas de verdad.
5. **¿Qué se hace con las instalaciones que ya tienen el scope huérfano?** D-0 previene hacia
   adelante, no repara hacia atrás. Depende del punto 2 de §13.

---

*aprobado por · nerv-arquitecto · 2026-09-01*
