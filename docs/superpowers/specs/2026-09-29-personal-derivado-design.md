# T-229 · Personal sigue al gasto y al pago — diseño

**Estado:** aprobado por el PO 2026-09-29 (brainstorming, sección 2, enfoque 1).
**Origen:** auditoría de negocio `engram/qa/auditoria-negocio-2026-09-29.md`, hallazgos H-2, H-3, H-4, H-5, H-6. Completa ADR-006 decisión 3. Va después de T-228.

## Problema

«Gastado» del mes en Personal debería ser la plata que salió de mi bolsillo (ADR-006 d3). Hoy la réplica de un gasto de grupo es un registro guardado que se escribe en un solo camino y se desincroniza en todos los demás:

- al crear vale el total que puse; al editar pasa a valer mi porción (H-2);
- borrar o restaurar el gasto, en este teléfono o por sync, no la toca (H-3);
- con varios pagadores acredita el total al pagador principal y nada a los demás (H-5);
- los gastos de grupo materializados por una recurrente no se replican (H-6);
- saldar no genera ningún movimiento: lo que pago nunca es gastado y lo que me pagan nunca es ingreso (H-4).

## Reglas (ADR-006 d3, no se reabren)

- Un gasto de grupo cuenta como gastado por **lo que puse yo** (`expensePayers(e)` filtrado por mí), en la fecha del gasto.
- Un pago que hago cuenta como gastado; un pago que me hacen cuenta como ingreso, en la fecha del pago.
- Lo que no salió de mi bolsillo (mi porción de lo que pagó otro) no es gastado hasta que la salde.
- Los derivados no se editan ni se borran desde Personal: se corrige el origen.

## Diseño (enfoque 1: derivar en lectura y congelar antes de purgar)

**Derivación pura.** `src/algorithms/movimientosDerivados.ts`:

```
movimientosDerivados({ expenses, payments, groups, me }) → PersonalEntry[]
```

- Por cada `Expense` no borrado con `groupId !== ''` donde puse algo: una entrada `group_replicated` con id `rep_<expenseId>`, monto = lo que puse, fecha y categoría del gasto, `sourceGroupExpenseId`, `sourceGroupId`.
- Por cada `Payment` no borrado donde soy `fromUserId`: `payment_out` con id `pay_<paymentId>`; donde soy `toUserId`: `payment_in`. `sourcePaymentId`, `sourceGroupId`, fecha del pago.
- **No se filtra por estado del grupo.** Archivar o borrar un grupo no cambia lo que gasté en el pasado. Sólo cuentan el tombstone del gasto o del pago y que yo participe (ids canónicos).
- `sourceGroupName` se completa desde `groups` (incluidos borrados y archivados) para que una entrada congelada conserve el nombre aunque el grupo ya no esté en el teléfono. El nombre de la contraparte de un pago se resuelve al mostrar (`getUserName`), porque los `User` no se purgan.

**Clases nuevas.** `PersonalEntryKind` suma `payment_out` (balde gastado) y `payment_in` (balde ingreso). Las dos son derivadas en `entryOrigin`. Campo opcional `sourcePaymentId`.

**Lectura unificada.** Un hook `useMovimientosPersonales()` devuelve los guardados vivos más los derivados, deduplicados por id: si el mismo id está guardado y derivado, gana el derivado (la fuente sigue en el teléfono y es la verdad). Lo usan el mes activo, sus totales, el rollover de mes, la exportación CSV y las monedas en uso. Actividad no cambia: los `personal_entry` siguen siendo sólo los manuales, y los pagos ya aparecen como `payment_made`.

**Congelar antes de purgar.** `purgarGrupoLocalmente(groupId)` calcula, antes de borrar nada, los derivados de ese grupo y los guarda en `personalStore` con los mismos ids. Así, salir de un grupo o elegir otra clave no borra el historial de Personal. Si después vuelve a bajar el grupo (clave en conflicto), los derivados vuelven a ganar por id y no hay duplicado.

**Dejar de escribir réplicas.** `useGuardarGasto` deja de crear y actualizar `group_replicated`; `personalStore.updateReplicatedEntry` se borra.

**Migración.** Una vez por cuenta (`adr006_replicados_v2`), se tombstonean las `group_replicated` guardadas que no tengan id `rep_…` (las viejas, con uuid). Reemplaza a la migración v1. En lectura, además, se ignoran las `group_replicated` guardadas sin id `rep_…`, por si la migración no corrió.

**Backup.** No cambia de formato: exporta los guardados (manuales, carryover, congelados). Los derivados se recalculan al restaurar.

## Pruebas

TDD, rojo antes que verde. Derivación: pagué el total, pagó otro, multi-pagador con mi parte, gasto borrado y restaurado, gasto editado, grupo archivado y grupo borrado siguen contando, pago hecho, pago recibido, pago ajeno, pago borrado, identidad vieja, recurrente de grupo. Lectura: guardado y derivado con el mismo id aparecen una sola vez; réplica vieja sin `rep_` se ignora. Purga: tras `purgarGrupoLocalmente`, los movimientos del grupo siguen en Personal con el mismo monto. Pantalla Personal: gasto de 1.000 que pagué más un pago mío de 200 da Gastado 1.200; borrar el gasto da 200. Nuevo gasto ya no escribe en `personalStore`.

## Riesgo declarado

El carryover de meses ya cerrados se calculó con las réplicas viejas y no se recalcula. No hay usuarios reales; el PO puede borrar un carryover a mano.
