# T-228 · Nadie sale con deuda viva — diseño

**Estado:** aprobado por el PO 2026-09-29 (brainstorming, sección 1).
**Origen:** auditoría de negocio `engram/qa/auditoria-negocio-2026-09-29.md`, hallazgos H-1, H-8, H-9, H-12. Cierra T-226.

## Problema

`deudasDelGrupo` descarta toda deuda con quien ya no está en el roster, mientras que el neto (`calculateBalancesByCurrency`) conserva lo que los que quedan se deben a través de esa persona. Tras una salida con absorción, el grupo muestra «Te deben 0 · Debés 0» arriba y un balance ≠ 0 abajo, Saldar dice «todo saldado» y la deuda no se puede cobrar. Lo mismo tras una expulsión o la salida automática al borrar la cuenta.

## Reglas (decisión del PO, no se reabren)

1. No se sale de un grupo mientras haya **cualquier deuda viva en cualquier dirección**, en cualquier moneda, con cualquier miembro. Como Splitwise y Tricount.
2. El creador no expulsa a nadie que tenga deuda viva en cualquier dirección.
3. Al borrar la cuenta, la salida automática sólo aplica a los grupos sin deuda viva; en el resto queda como «Cuenta borrada».
4. Borrar el grupo se permite, con un modal que lista las cuentas abiertas (a quién y cuánto).
5. La absorción de saldo se elimina.

## Diseño

**Un predicado, un módulo.** `src/algorithms/deudaViva.ts`:

- `deudasDe(deudas, userId)`: las `DeudaPar` donde esa persona es deudora o acreedora (ids canónicos).
- `tieneDeudaViva(deudas, userId)`: `deudasDe(...).length > 0`.
- `monedasConDeuda(deudas, userId)`: monedas distintas, en orden de aparición.

La fuente es siempre `deudasDelGrupo` sobre los gastos del grupo y `pagosQueCuentan`. No se usa el neto para decidir salidas.

**Consumidores:**

| Acción | Dónde | Con deuda viva | Sin deuda |
|---|---|---|---|
| Salir | `useAccionesDeGrupo.handleLeave` | Modal bloqueante con las líneas por persona (`cuentasPorPersona`); «Saldar lo que debo» sólo si soy deudor de alguien | Confirmación de siempre → `salirDelGrupo` |
| Expulsar | `expulsarDelGrupo.expulsar` devuelve `'con_deuda'`; la pantalla lo chequea antes de ofrecer el botón | Modal `expel_blocked_*` con las líneas, sin botón Expulsar | Confirmación de siempre → baja en el roster, **sin pagos** |
| Borrar cuenta | `salidasAlBorrar.gruposParaSalir` | El grupo no entra en la lista | Sale |
| Borrar grupo | `MenuDeGrupo` | Modal `delete_body_with_debts` con las líneas | `delete_body` de siempre |

Salir y expulsar usan `lineasDeCuentas` del hook (me debe / le debo); borrar el grupo usa `lineasDeDeudas` en `detalleDeGrupo.ts` (X le debe a Y), porque ahí las deudas no me involucran necesariamente.

**Lo que se elimina:** `app/groups/leave.tsx`, `absorbBalance.ts`, `canLeaveGroup.ts`, `leaveRequest.ts`, `applyLeave.ts`, `PedidoDeSalida.tsx`, `leaveApprovalCore.ts`, `leaveApprovalSign.ts`, `settleSuggestion.ts`, `acreedoresDe` (en `repartoSaldo.ts`), `saldosParaSalir`; en el modelo, `Group.leaveRequest`, `LeaveRequest`, `LeaveApproval`, `ApprovalEntry`; en `groupStore`, `requestLeave`/`approveLeave`/`cancelLeave`; en `paymentStore`, la opción `derived`; en el sync, la unión colaborativa de `approvedBy` (`mergeLevels`), el slot `leaveRequest` de `GROUP_SLOTS` (`recordCore`) y la clase `leave` de `derivedRecords`; las llamadas a `applyApprovedLeaves` en `session.ts` y `agendaDeDrenaje.ts`; la ruta `groups/leave` en `app/_layout.tsx` y en los guards `pestanasUnificadas` e `intencionNativa`; las claves i18n `leave.*`, `group_detail.leave_last_member` y `group_detail.expel_body_with_balance`.

**Compatibilidad:** un sobre viejo con `leaveRequest` lo arrastra el merge como campo desconocido y nadie lo lee. No hay usuarios reales, así que no hay limpieza de datos.

## Pruebas

TDD, rojo commiteado antes que verde. Predicado con los cinco casos (sin deuda, debo, me deben, deuda ajena, cruzadas neto 0). Pantalla: salir y expulsar bloquean en las dos direcciones y con neto 0; «Saldar» sólo aparece si debo; sin deuda sale y expulsa sin crear pagos; borrar cuenta excluye grupos con deuda en cualquier dirección; borrar grupo lista las deudas. Guards de tope de líneas, ciclos de imports y paridad i18n verdes. `tsc` y `eslint` limpios.

## Fuera de alcance

Traspaso (T-058): sigue trasladando el neto, que coincide con el par porque nadie sale con deuda viva.
