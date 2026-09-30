# Modo «con acuerdo» (`consensus`): mapa para sacarlo y para volver a traerlo

**EXTRAÍDO en T-186** (Task 1 @ `851787c`, Task 2 @ `46d29e3`, rama `chore/sacar-consenso`). El código descripto en este documento ya no existe en el árbol — vive, entero, en el tag `consenso-antes-de-T-186`. Este documento queda como el mapa para retomar el modo (§8) si alguna vez hiciera falta; §1-§7 describen el estado ANTERIOR a la extracción, con archivo:línea leídos contra ese tag, no contra el HEAD actual.

**Estado:** PENDIENTE PARA EL FUTURO. Decisión del PO del 2026-09-27: por ahora hay un solo tipo de grupo, el «libre» (cualquier miembro edita, borra y restaura al instante, como Splitwise). El modo «con acuerdo» se sacó de cuajo en **T-186** (`engram/03_backlog.md:1452`).
**Autor:** nerv-arquitecto · 2026-09-27 · relevado sobre `dev` @ `dd86ae6`.
**Tag de rescate:** `consenso-antes-de-T-186` — todo lo que figura acá con archivo:línea se lee ahí, no en el HEAD actual.

Este documento sirve para dos cosas: es la **lista de extracción** para quien haga T-186 (§7) y es el **mapa para retomar el modo** sin tener que redescubrirlo (§8).

---

## 1. Qué es el modo con acuerdo (reglas vigentes hasta T-186)

- **Regla 2, borrado consensuado** (`CLAUDE.md:188`; `docs/ARCHITECTURE.md:128-196` `#deletion-consensus`; UX en `docs/FEATURES.md:93-116`). Un miembro *pide* el borrado, lo que abre una ronda. Los demás tienen **72 h** para objetar (`DELETION_TIMEOUT_MS`, `src/sync/SyncEngine.ts:8`). Si nadie objeta, el gasto se borra. El creador del gasto puede *forzar* el borrado, que es inmediato. Quien pidió puede retirar su pedido. Cualquier miembro restaura.
- **Regla 3, borrar ≠ liquidar** (`CLAUDE.md:189`; `docs/ARCHITECTURE.md:198-236` `#debt-settlement`, subsección «El acuse de recibo» en `:218`). En un grupo `consensus`, el saldado que declara **quien paga** queda `pendiente` hasta que **quien cobra** lo confirma o lo rechaza. Mientras está pendiente cuenta en el balance (D1). No hay plazo automático (D2). Si lo declaró quien cobra se efectiviza directo (D3). Ver `engram/plans/T-064.md:17-23`.
- **El modo se fija al crear el grupo y no cambia.** Si falta el campo, el grupo se trata como `consensus`, el modo más restrictivo (`src/algorithms/deletionPolicy.ts:20-27`).

Tickets, con lo esencial de cada uno:

| Ticket | Qué dejó | Dónde |
|---|---|---|
| T-041 | Votos firmados. Con S8 llegan las 4 acciones (pedir/objetar/retirar/restaurar), el `roundId` va dentro de la firma y R3 hace que el override del creador «se honre siempre», con restaurar en un toque | `engram/plans/T-041.md:375` (R3), `engram/03_backlog.md:43,552` |
| T-053 | El modo se podía bajar de `consensus` a `open` por sync (el `Group` es LWW). Se cerró así: el modo se toma sólo la primera vez que el aparato ve el grupo | `engram/03_backlog.md:533`, `mergeDeletionMode` |
| T-064 | Acuse de recibo firmado y colaborativo. Estado derivado `efectivo/pendiente/rechazado` | `engram/plans/T-064.md`, `engram/03_backlog.md:845` |
| T-065 | Aprobaciones de salida firmadas. **No depende del modo** (ver §2) | `engram/03_backlog.md:826` |
| T-143 | Un `forced` sin firma que cierre no borra al instante: se degrada a una ronda de 72 h | `engram/03_backlog.md:1167` |
| T-144 | Tope de reloj: un `updatedAt` o un voto del futuro no ganan (`TOLERANCIA_RELOJ_MS`) | `engram/03_backlog.md:1174` |
| T-145 | Sólo cuenta un acuse cuya firma verifica | `engram/03_backlog.md:1184` |
| T-152 | Un núcleo sin firma no pisa a uno firmado. Es general y **se queda** | `engram/03_backlog.md:1244` |
| T-169 | `isDeleted` es LWW liso, así que cualquiera borra sin votar y el consenso queda puenteado. **CANCELADO**: es la razón de fondo de T-186 | `engram/03_backlog.md:1293` |
| T-170 | La autoría se disputa (`autoriaDisputada`). Con una disputa abierta, ningún `forced` es inmediato. El atajo D3 exige un núcleo válido | `engram/03_backlog.md:1301`, `engram/plans/T-169-170.md` |

ADR: el que lo rige es **ADR-016** (`engram/02_architecture.md:922`). Su punto 1 («la firma autoriza efectos sin testigo») es general. Su punto 2 (el tombstone como reclamo que «justifica el grupo `open` o la regla 2») **nunca se implementó**, porque T-169 se canceló. Su punto 4 (el atajo D3) es sólo de T-064. Las reglas R1/R2/R3 salen de ADR-004 (`docs/ADR-004-identidad-por-cuenta.md`).

## 2. Modelo de datos (`src/types/models.ts`)

- `DeletionMode = 'consensus' | 'open'` (`:206`). `Group.deletionMode?` (`:283`, con el docblock en `:269-282`).
- `DeletionVote` (`:182-195`) tiene estos campos: `userId`, `votedAt`, `action: 'delete'|'cancel'|'withdraw'` (el token de compatibilidad), `intent?: 'restore'` (un `cancel` sin `intent` significa objetar), `roundId?` (va dentro de la firma), `forced?` (el override del creador), `k?`/`s?` (la pública y la firma del enunciado). El docblock (`:157-181`) explica por qué hay 4 acciones metidas en 3 tokens.
- `Expense.deletionVotes: DeletionVote[]` (`:353`). `Group.deletionVotes: DeletionVote[]` (`:268`). **Nadie escribe en el del grupo** salvo el `[]` inicial: es peso muerto, aunque se une en el merge.
- `SettlementConfirmation` (`:415-425`: `userId`, `confirmedAt`, `action: 'confirm'|'reject'`, `k?`, `s?`) y `Payment.confirmations?` (`:445`, con el docblock en `:439-444`). El comentario `// Payment ... No necesita consenso.` (`:405`) ya está desactualizado.
- `LeaveRequest` / `LeaveApproval` / `ApprovalEntry` (`:198-260`) y `Group.leaveRequest?` (`:291`): **NO dependen del modo**. `src/algorithms/leaveRequest.ts`, `canLeaveGroup.ts`, `src/services/applyLeave.ts` y `src/sync/leaveApproval{Core,Sign}.ts` no leen `deletionMode` ni importan nada de votos. La salida con saldo necesita la aprobación de todos en los dos modos (y desde T-181, sólo de los involucrados en el plan). **Se queda.** — *Nota 2026-09-29: se eliminó en T-228 (nadie sale con deuda viva, sin absorción).*
- En la clasificación de firma (`src/sync/recordCore.ts`), los tres campos son `'fuera'`: `deletionVotes` (`:81` en expense, `:171` en group), `confirmations` (`:101`) y `deletionMode` (`:172`). **No entran en el mensaje firmado** (`coreOf` sólo copia `CORE_FIELDS`, `:225-236`), así que sacarlos no invalida ninguna firma ni obliga a subir `CORE_VERSION`.

## 3. Algoritmos

| Pieza | Qué hace | Destino en T-186 |
|---|---|---|
| `src/algorithms/deletionPolicy.ts` | `deletionModeOf` (`:25`), `borraAlInstante` (`:30`: pertenencia + modo + override), `puedeRestaurar` (`:61`, **no lo usa nadie fuera de su test**), `mergeDeletionMode` (`:86`, T-053) | Se borra. Lo único que sobrevive es el chequeo de pertenencia con `mismaPersona` (`:48`) |
| `src/algorithms/deletionRound.ts` | `deletionRound` (`:48`: `open/objected/restored`, `requestedBy`, `stoppedBy`, `expiresAt`), `msUntilDeletion` (`:64`), `hasObjected`/`hasRequested` (`:90,95`) | Se borra |
| `src/sync/SyncEngine.ts` | `DELETION_TIMEOUT_MS` (`:8`), `aperturaDeRonda` (`:54`), `mergeDeletionVoteSets` (`:118`, la unión del merge), `mergeDeletionVotes` (`:155`, el colapso por ronda+persona), `resolveDeletionVotes` (`:225`) | Se borran las cinco. `mergeData`/`buildDelta` se quedan |
| `src/services/resolveDeletions.ts` | `resolvePendingDeletions` (`:34`): aplica los vencidos y los `forced` confiables. La llaman `src/store/session.ts:104` y `src/sync/relayEngine.ts:309` | Se borra junto con las dos llamadas |
| `src/algorithms/settlementStatus.ts` | `requiereConfirmacion` (`:61`, lee `deletionMode` en `:65`), `contextoReal` (`:79`), `envenenado` (`:95`), `acuseVigente`, `estadoDelSaldado` (`:138`), `pagosQueCuentan` (`:161`), `saldadosPendientes` (`:171`) | Se queda sólo `pagosQueCuentan`, reducido a `payments.filter(p => p.groupId === group.id)` |
| `src/store/mergeLevels.ts` | `unirVotos` (`:65`), `unirAcuses` (`:90`), `COLABORATIVOS` (`:149-155`) | Se borran `unirVotos` y `unirAcuses`. `COLABORATIVOS` queda en `expense: [autoriaDisputada]`, `group: [leaveRequest]` y `payment: []`. El docblock de `:26` se corrige |
| `src/sync/forcedTrust.ts` | `esForcedConfiable` (`:25`): `!enDisputa && checkVote === 'valida'` | Se borra |
| `src/sync/autoriaTrust.ts` | `enDisputa`/`autoresVerificados` (`:83,102`): verifica los núcleos competidores | **Se queda**: alimenta el banner de disputa de `app/expense/[id].tsx:138-150` y es verificación general de autoría (ADR-016 punto 3) |
| `src/algorithms/recordTrust.ts` | `attributedVote` (`:85`); importa `voteCore` (`:1`) y `DeletionRound` (`:3`) | Se borra `attributedVote`. `trustOf`/`isMarked`/`TrustState` se quedan |
| `src/store/mergeGroupsPure.ts:2,27-28` | Aplica `mergeDeletionMode` | Se saca |

## 4. Firmas

- `src/sync/voteCore.ts` (256 líneas): `accionDe` (`:36`), `enElFuturo` (`:65`), `frenaLaRonda` (`:70`), `rondaDe`/`esDeLaRonda` (`:79,96`), `roundIdFor` (`:128`), `voteStatement`/`canonicalVote` (`:144,158`), `rondaVigente` (`:225`). **Ojo:** `TOLERANCIA_RELOJ_MS` (`:54`) es general. La importan `src/store/relojDelMerge.ts:1` (el tope de reloj de T-144, que se queda) y `settlementStatus.ts:3`. Antes de borrar el archivo, hay que mudar la constante a `relojDelMerge.ts`.
- `src/sync/voteSign.ts`: `signVote`/`verifyVote` (`:27,45`). Se borra.
- `src/sync/trustCheck.ts`: `checkVote` (`:122`) se borra. `checkRecord` (`:46`) **se queda**.
- `src/hooks/useRecordTrust.ts`: `useVoteTrust` (`:229`) y los imports `checkVote`/`canonicalVote` (`:2,5`) se borran. `useRecordTrust` se queda.
- `src/services/deletionVotes.ts`: `AccionDeVoto` (`:29`: `delete/force/object/withdraw/restore`), `TOKEN` (`:49`), `firmar`, `emitirVoto` (`:80`). Se borra.
- T-064: `src/sync/settlementCore.ts` (`SETTLEMENT_VERSION`, `settlementStatement`, `canonicalSettlement`), `settlementSign.ts` (`signSettlement`/`verifySettlement`), `settlementTrust.ts` (`checkSettlement`, `:66`) y `src/services/settlementConfirm.ts` (`puedeAcusar` `:48`, `emitirAcuse` `:60`, `acusarRecibo` `:82`). Se borran los cuatro.
- **Se quedan:** `recordSign`/`recordCore`/`signOnWrite`/`authorKeys`/`verdictCache` (la firma de núcleo, T-041) y `leaveApproval{Core,Sign}` (T-065).

## 5. UI y textos

- **`app/expense/[id].tsx`**: los imports `:22,32,37`; la ronda y la marca del voto `:97-112`; `puedeForzar` `:139` (el banner de disputa `:141-150` se queda); `borradoDirecto` `:162-164`; `hayPedido/yoPedi/yoObjete` `:195-197`; `pedirBorrado` `:207`; `forzarBorrado` `:214` (**es el borrado del modo libre**: sobrevive como `isDeleted: true` sin voto); el diálogo `:228-268` (la rama `open` `:237-245` pasa a ser la única); `objetarBorrado` `:271`; `retirarPedido` `:286`; lo restante y el título/cuerpo de la ronda `:295-307`; la banda de la ronda `:458-480`; los botones objetar/retirar/pedir `:484-495`.
- **`app/groups/new.tsx`**: `useState<DeletionMode>` `:47`; `deletionMode` en el alta `:95`; el selector de radio `:185-228` (con `groups.deletion_fixed` `:227`).
- **Actividad**: los eventos `expense_delete_request` y `expense_restored` en `src/store/selectors.ts:317,332,405-430` (salen de `deletionRound`). `src/screens/activity/components/EventRow.tsx:158` (pedido), `:160` (la fecha sale de `deletionVotes[0]`) y `:205` (restaurado). `src/screens/activity/hooks/useActivityTrust.ts:14-18,31-32` (la marca del voto). `src/screens/activity/hooks/useRestoreExpense.ts:21` (restaurar emite un voto `restore`).
- **Avisos**: en `src/services/syncNotices.ts`, el kind `deletion` (`:43`), `restored` (`:51`, se queda), `settlement_pending` (`:74`), `borradoPendiente` (`:220`), el pedido `:299-310`, `loRestauréYo` `:333-334`, la rama de acuse `:394-404`, `esAccionable` (`:151-154`) y `msRestanteDeBorrado` (`:455`). En `src/services/notifications.ts:136,146,188,210-215`. En `src/components/NoticeInboxSheet.tsx:39-48,118,184`, y el comentario de `src/components/TabHeader.tsx:87`. `noticeInboxStore.ts` no tiene lógica propia del modo: filtra por `esAccionable`.
- **Saldar**: `src/components/SettlementAcuse.tsx` (entero), `src/hooks/useSaldadoAcuse.ts` (entero) y el uso en `app/groups/[id].tsx:37,41,717,745`. `pagosQueCuentan` aparece en `src/store/selectors.ts:51,92,132,187,247`, `src/algorithms/globalBalances.ts:58`, `historialConContacto.ts:53`, `app/settle/new.tsx:147` y `src/services/groupTraspaso.ts:79`. Todos siguen igual si la función sobrevive simplificada. `groupTraspaso.ts:99` copia `deletionMode`: se saca.
- **i18n** (`src/i18n/locales/es.json`, más `en`/`pt` con las mismas claves):
  - `groups.deletion_{label,consensus,consensus_hint,open,open_hint,fixed}` (`:147-152`)
  - `expense.delete_{body_creator,body_member,pending_title,pending_body,request,force,objected_title,objected_body,restored_title,restored_body}` más `request_delete`, `object_delete` y `withdraw_request` (`:227-265`)
  - `settlement.{did_you_receive,confirm,reject,waiting,rejected}` (`:294-298`)
  - `delete.*` entero (`:301-312`): **ya es huérfano**, ningún `t('delete.…')` en el código
  - `activity.action_requested_delete` (`:327`)
  - `settings.notif_delete_requests` (`:349`, se reetiqueta porque el toggle `notif_deletions` sigue sirviendo para `restored`)
  - `notifications.deletion_{requested,remaining,no_time}` (`:681-683`) y `notifications.settlement_pending` (`:699`)
  - **Se quedan:** `expense.delete_title`, `delete_body_open`, `delete_expense`, `activity.restore`/`deleted_title`/`action_restored`, `notifications.restored` y `settle.pending_balance` (el saldo restante, que no es acuse).

## 6. Tests

**Sólo existen por el consenso, se borran enteros (21):**
`src/algorithms/__tests__/{deletionPolicy,deletionRound,deletionAcciones,acuseSinFirma,atajoAcreedorFirmado}.test.ts` ·
`src/services/__tests__/{deletionVotes,deletionVotesSinIdentidad,resolveDeletions,settlementConfirm,avisoPagoForjado,avisoPagoPropio}.test.ts` ·
`src/sync/__tests__/{deletionVotesMerge,relojDeLosVotos,forcedSinFirma,settlementSign,settlementTrust}.test.ts` ·
`src/components/__tests__/SettlementAcuse.test.tsx` · `src/hooks/__tests__/useSaldadoAcuse.test.tsx` ·
`src/algorithms/__tests__/settlementStatus.test.ts` (**salvo** el describe `:145` «nadie vuelve a filtrar los pagos a mano», que es un guard general y se muda) ·
`src/store/__tests__/activityRestaurado.test.tsx` (se reescribe si el PO elige la opción B de §7) ·
`src/sync/__tests__/trustCheck.test.ts`, sólo el describe `checkVote` (`:135`).

**Mezclan consenso con lógica general, se podan:**
`src/sync/__tests__/SyncEngine.test.ts` (describe `mergeDeletionVotes` `:87`; `mergeData`/`buildDelta` se quedan) ·
`src/store/__tests__/mergeLevels.test.ts` (el describe de acuses `:296` y el fixture de votos `:53-55`) ·
`src/store/__tests__/mergeNivelesEnLosStores.test.ts` (`:111-148`, el voto de un tercero) ·
`src/store/__tests__/fusionDeCuentasPorNiveles.test.ts` (`:42`, `:53`) ·
`src/store/__tests__/fusionUsaMergeDelStore.test.ts` (D2 `:99`) ·
`src/store/__tests__/groupLifecycle.test.ts` (`:107-114`) ·
`src/screens/__tests__/expenseDetail.test.tsx` (describe `borrado consensuado` `:105`) ·
`src/screens/__tests__/groupSettleVisibility.test.tsx` (`:143`, `:152`) ·
`src/screens/__tests__/marcaEnLaUI.test.tsx` (`:226`) ·
`src/services/__tests__/syncNotices.test.ts` (describe `pedidos de borrado` `:89` y los de acuse) ·
`src/components/__tests__/NoticeInbox.test.tsx` (kinds `deletion`/`settlement_pending`, `:19-38`) ·
`src/utils/__tests__/syncedClockCoverage.test.ts` (describe `:72`) ·
`src/store/__tests__/noticeInboxMarkNonActionable.test.ts`, `activityDeleted.test.tsx`, `actividadFilas.test.tsx`, `actividadMiParte.test.tsx`, `historialConContacto.test.ts`, `groupTraspaso.test.ts`, `TabHeader.test.tsx` y `useRecordTrust*.test.ts`.

**Sólo tienen fixtures** (`deletionVotes: []`, `deletionMode: 'consensus'`, `confirmations: []`): son unos 60 archivos más, más `src/test-utils/recordFixtures.ts:38,73,122,123`. Cuando el tipo pierda el campo, `tsc` los marca. Los fixtures `as any` (por ejemplo `acotarDeltaAlGrupo.test.ts:20-29`) no los marca, pero dejarlos no rompe nada.

## 7. Lista de extracción propuesta (T-186)

**Se borra entero:** `src/algorithms/{deletionPolicy,deletionRound}.ts`, `src/services/{deletionVotes,resolveDeletions,settlementConfirm}.ts`, `src/sync/{voteCore,voteSign,forcedTrust,settlementCore,settlementSign,settlementTrust}.ts`, `src/components/SettlementAcuse.tsx`, `src/hooks/useSaldadoAcuse.ts`, los tipos `DeletionMode`/`DeletionVote`/`SettlementConfirmation` y los campos `Expense.deletionVotes`, `Group.deletionVotes`, `Group.deletionMode` y `Payment.confirmations`.

**Se simplifica:**
- `borraAlInstante` desaparece. `borradoDirecto` pasa a ser «es miembro del grupo (con `mismaPersona`)», con el mismo fallback de hoy si el grupo no resuelve (`app/expense/[id].tsx:162-164`).
- Borrar = `updateExpense(id, {isDeleted: true})` más la cascada de comentarios. Restaurar = `{isDeleted: false}`. Ninguno de los dos escribe votos.
- `settlementStatus.ts` se reduce a `pagosQueCuentan`. No hay ramas pendiente/rechazado ni `saldadosPendientes`.
- `mergeDeletionVoteSets`/`mergeDeletionVotes`/`resolveDeletionVotes`/`DELETION_TIMEOUT_MS` desaparecen de `SyncEngine.ts`.
- `COLABORATIVOS` pierde `deletionVotes` y `confirmations` (`mergeLevels.ts:149-155`).
- `mergeGroupsPure.ts` pierde `mergeDeletionMode`.
- `recordCore.ts` pierde tres slots `'fuera'`. La firma no cambia.
- `syncNotices` pierde `deletion` y `settlement_pending`, y `esAccionable` se queda con `sync_down` más los que ya tenía.
- `TOLERANCIA_RELOJ_MS` se muda a `src/store/relojDelMerge.ts`.

**Se queda (no es del consenso):** la firma de núcleo (`recordCore/recordSign/signOnWrite/trustCheck.checkRecord`), `autoriaTrust` + `autoriaDisputada` + `unirAutoria`, el merge por niveles (`coreWins`/`restoWins`, el tope de reloj de T-144, T-152), el roster y `leaveRequest` con sus aprobaciones firmadas (T-065/T-181; eliminado después en T-228), y el aviso `restored` (T-061).

**Decisión del PO pendiente (trade-off de UX):** hoy la Actividad sabe **quién** restauró, y con qué firma, porque lo saca del voto (`selectors.ts:423-428`, `useActivityTrust.ts:31-32`). En el modo libre también se emite un voto `force` al borrar (`app/expense/[id].tsx:217`). Si se sacan los votos, se pierde esa atribución.
- **A.** Sin atribución: el evento dice «restaurado», sin nombre.
- **B.** Agregar `deletedById`/`restoredById` como campos del «resto» (LWW, sin firmar y falsificables por un co-miembro).
- Descartada: quedarse con un log firmado de borrar/restaurar, porque es rearmar la mitad de `voteCore` para una etiqueta.

**Riesgos:**
1. Los sobres y los registros guardados siguen trayendo `deletionVotes`/`confirmations`/`deletionMode`. Nadie los lee, pero `mergeRecord` los arrastra en el objeto ganador y se vuelven a publicar. No hay usuarios, así que no hace falta compatibilidad hacia atrás. Si se quiere limpiar, alcanza con descartarlos al cargar (una sola vez).
2. Los pagos que hoy están `rechazado` vuelven a contar. Sólo existen en aparatos de prueba.
3. Con el cambio, T-169 (el tombstone por LWW) pasa a ser el **comportamiento de producto** y deja de ser un agujero. ADR-016 hay que enmendarlo: el punto 2 se da de baja y el punto 4 cae con T-064.
4. `CLAUDE.md:188-189`, `docs/ARCHITECTURE.md:128-236` y `docs/FEATURES.md:93-116` hay que reescribirlos en el mismo PR. Si no, vuelven a mandar a los agentes por el camino viejo (ver la advertencia de la regla 8).
5. `syncNotices.ts:333` usa la ronda para no avisarle a uno de su propia restauración. Sin ronda, esa exclusión depende sólo de `teniaBorrados`: hay que cubrirla con un test.

## 8. Cómo volver a traerlo

Los puntos de reenganche, en el orden en que hay que tocarlos:

1. **Primero, el prerequisito que lo hundió.** Sin resolver T-169 (el `isDeleted` LWW que puentea cualquier regla de borrado) el modo vuelve a nacer roto. El diseño que había es ADR-016 punto 2: separar `registros` (lo que se sincroniza) de la vista, y que la vista sólo apague los tombstones que justifica la ronda o un `forced` confiable. El plan está en `engram/plans/T-169-170.md`.
2. **Modelo:** volver a poner los campos de §2 y sus slots `'fuera'` en `recordCore.ts`. `Record<keyof X, CoreSlot>` obliga a clasificarlos, y el compilador lo recuerda.
3. **Merge:** `COLABORATIVOS` en `mergeLevels.ts` (unir votos y acuses) y la regla del modo inmóvil de T-053 en `mergeGroupsPure.ts`. Antes de reactivar, conviene firmar el modo junto con la creación del grupo en vez de protegerlo con `mergeDeletionMode`.
4. **Decisión de borrado:** hay un solo punto, el predicado que reemplace a `borradoDirecto` en `app/expense/[id].tsx`, más el resolvedor que corre solo desde `session.ts` y `relayEngine.ts`.
5. **Acuse:** `pagosQueCuentan` sigue siendo la única puerta del balance (el guard de `settlementStatus.test.ts:145` la protege). Reintroducir `estadoDelSaldado` ahí adentro alcanza para que las 9 pantallas lo respeten.
6. **Avisos:** los kinds en `Notice` y en `esAccionable`, y el selector de `app/groups/new.tsx`.
7. **Código de referencia:** en el tag `consenso-antes-de-T-186` están las 4 acciones con compatibilidad de tokens (`voteCore.ts`), las rondas por `roundId` firmado y los guards de reloj. Los tests borrados (§6) son la especificación ejecutable: se restauran con `git checkout <tag> -- <ruta>`.
