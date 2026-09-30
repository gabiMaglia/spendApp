# Algoritmos: reparto, deuda, saldo y salida

**Describe lo que corre hoy** (reescrito 2026-09-29 tras la auditoría de negocio, `engram/qa/auditoria-negocio-2026-09-29.md`). Cada sección nombra el archivo real; si el código y este documento difieren, gana el código y hay que corregir acá.

Reglas transversales:

- **Todos los montos son enteros en la menor unidad de su moneda** (ADR-002): 1.234,56 ARS es `123456`; 1.500 CLP es `1500`. Nada de floats, nada de `Math.round(x*100)/100`, nada de epsilon. «Saldado» es `=== 0`.
- **Las monedas nunca se mezclan.** Cada grupo tiene UNA moneda (se elige al crearlo, `app/groups/new.tsx`) y todos sus gastos y pagos van en ella. Los totales convertidos que muestran Personal, Grupos y Amigos son valores de pantalla (`src/services/fx.ts`, `fxTotals.ts`) y nunca entran a un registro.
- **Los ids de persona entran por `idCanonico()`** (T-048): quien enlazó dos cuentas tiene registros con las dos identidades y el cálculo las colapsa al entrar, no al comparar.
- **Determinismo entre teléfonos:** todo resto de una división se reparte con un criterio fijo (userId ascendente, o el orden de la matriz), para que dos dispositivos que calculan por separado lleguen al mismo número.

---

## 1 · Dividir un gasto — `src/algorithms/buildSplits.ts`

`buildSplits(total, memberIds, mode, values?)` devuelve `Split[]` cuya suma es EXACTAMENTE `total`.

| Modo | `values` | Cómo reparte el resto |
|---|---|---|
| `equal` | — | `floor(total/n)` a todos; las `total − base·n` unidades sobrantes van de a 1 a los primeros por userId ascendente |
| `percentage` | un % por miembro (suman 100) | `round(total·pct/100)`; la diferencia contra el total se corrige de a 1 unidad por userId ascendente |
| `shares` | partes enteras ≥ 0 por miembro | `floor(total·sh/Σsh)`; resto de a 1 por userId ascendente, saltando a quien tiene 0 partes |
| `custom` | un monto por miembro **menos el último** | el último recibe `total − Σ otros` |

La pantalla Nuevo gasto (`src/screens/expense/repartoDeGasto.ts`) expone sólo `equal` y `percentage` (con «mismo %» y «% a medida»; el último miembro recibe `100 − Σ`). `shares` y `custom` existen en el algoritmo y los usan las plantillas recurrentes y el traspaso.

## 2 · Varios pagadores — `src/algorithms/payers.ts`

Un gasto lleva `paidById` (pagador principal, siempre) y opcionalmente `payers: [{userId, amount}]` cuya suma es exactamente `amount`. **Nadie lee esos campos directo:** `expensePayers(expense)` normaliza las dos formas (sin `payers` ⇒ un pagador que puso el total). `primaryPayerId` es el que más puso, con desempate por userId menor. `normalizePayers` descarta los que pusieron 0 y devuelve `payers: undefined` cuando queda uno solo (la clave va SIEMPRE, porque al editar se aplica con spread).

## 3 · Deuda por par, sin compensar — `src/algorithms/deudasDelGrupo.ts`

Es la **definición de deuda** del producto (ADR-006, enmienda T-225): dentro de cada grupo, por moneda, **lo que A le debe a B y lo que B le debe a A son dos números distintos** y ninguno achica al otro.

```
deudasDelGrupo(expenses, payments, memberIds) → DeudaPar[]  // {deudor, acreedor, currency, monto > 0}
```

1. Por cada gasto vivo: cada participante del `split` le debe su parte a quien pagó. Con varios pagadores, la parte de cada participante se reparte entre los pagadores **en proporción a lo que puso cada uno**, en enteros y con los dos márgenes exactos (`repartirEntrePagadores`: filas = partes, columnas = lo pagado; primero el piso `floor(parte·pago/total)`, después los centavos sobrantes en orden de matriz). Un participante que también pagó no se debe a sí mismo.
2. Por cada pago vivo A→B: **baja sólo lo que A le debe a B**. Si el pago excede esa deuda, el excedente queda como deuda de B con A (como en Splitwise: pagar de más invierte la deuda).
3. Una deuda con alguien que **no está en el roster** no se cuenta. ⚠️ Es el hallazgo H-1 de la auditoría: si alguien saliera con deuda viva, las deudas que los demás tenían «a través» de esa persona desaparecerían del par mientras el neto (§4) las conserva. Por eso nadie sale con deuda viva (§7).

Helpers: `deudaEntre(deudas, deudor, acreedor, currency)`, `totalesDeUsuario(deudas, userId)` → `[{currency, owedToYou, youOwe}]`.

**Invariante con test de propiedad** (`deudasDelGrupo.property.test.ts`, 40 escenarios): para cada persona, `owedToYou − youOwe` = su neto de §4.

## 4 · Neto por persona — `src/algorithms/calculateBalances.ts`

`calculateBalancesByCurrency(expenses, payments, memberIds)` devuelve, por persona y moneda, `Σ lo que puso − Σ su parte + Σ pagos hechos − Σ pagos recibidos`. Positivo = le deben, negativo = debe. Sólo cuenta a quienes están en `memberIds`; los ids ajenos se ignoran al acreditar.

El neto **ya no define cuánto debe nadie**. Sirve para:
- el «Balance de grupo» debajo del timeline del detalle;
- la tarjeta de cada amigo en Amigos (neto de esa persona sumando grupos);
- el traspaso (§8).

`calculateBalances(expenses, memberIds)` es la versión mono-moneda, sin pagos, que usa `globalBalances.ts` (legado: sigue exportado pero las pantallas usan `selectoresDeDeuda.ts`).

## 5 · Qué pagos y qué grupos cuentan

- `pagosQueCuentan(payments, group)` (`settlementStatus.ts`): del grupo y sin tombstone. Es la **única puerta** de los pagos al balance; un test escanea el árbol para que nadie filtre `payments` a mano.
- `gruposQueCuentan(groups, archivedIds, userId)` (`gruposQueCuentan.ts`): no borrados, no archivados, donde soy miembro (con identidad vieja incluida). Lo usan los casilleros de Grupos/Personal/Amigos y Saldar desde Amigos.

## 6 · Saldar

**Reglas (ADR-006 d1/d2 + T-225):** saldar es direccional («yo no te debo más», lo que vos me debés queda intacto); se salda a una persona.

| Desde | Monto | Registros | Archivo |
|---|---|---|---|
| Detalle de grupo, «de a uno» | prellenado con `deudaEntre(from, to)`; parcial permitido; tope = esa deuda (`topeDelSaldo`) | 1 `Payment` | `useDeudaDelPar.ts`, `useGuardarSaldo.ts` |
| Detalle de grupo, «Todo» | `Σ lo que debo en el grupo`; si el monto no cubre, `repartoParejo` reparte de a 1 unidad de mayor a menor acreedor, nunca más de lo debido a cada uno | 1 `Payment` por acreedor | `repartoSaldo.ts` |
| Amigos | la **totalidad** de lo que le debo a esa persona, sin parcial | 1 `Payment` por grupo compartido (y por moneda) | `saldoSinCompensar.ts`, `useSaldoConAmigo.ts` |

Cualquier miembro puede registrar un pago, incluso en nombre de otro («De:»), y cuenta al instante: no hay acuse (T-186). `simplifyDebts` (greedy: mayor deudor contra mayor acreedor) sigue existiendo **sólo como sugerencia** de cómo cerrar un grupo con menos transferencias; no decide cuánto debe nadie.

`Payment.targetCurrency`/`exchangeRate` se leen en los cálculos pero **no tienen UI**: hoy un pago va siempre en la moneda del grupo.

## 7 · Salir, expulsar y borrar la cuenta

**Regla (decisión del PO 2026-09-29, auditoría H-1):** no se sale ni se expulsa a nadie mientras haya **cualquier deuda viva en cualquier dirección** con quien se va, como Splitwise («settle up first») y Tricount. No existe absorción de saldo: nadie se hace cargo de la deuda de otro.

- **Salir** (`useAccionesDeGrupo.handleLeave`): si `deudasDelGrupo` tiene alguna entrada donde soy deudor o acreedor → bloqueado con modal que lista, por persona, cuánto me deben y cuánto debo (`cuentasPorPersona`) y ofrece Saldar. Sin deuda → `salirDelGrupo` (baja en el roster, publicar, marcar pendiente de drenaje, purgar copia local).
- **Expulsar** (sólo el creador, `expulsarDelGrupo.ts`): mismo predicado sobre las deudas del expulsado con cualquiera; bloqueado si hay alguna, con el mismo modal.
- **Borrar la cuenta** (`deleteAccount.ts`, `salidasAlBorrar.ts`): sale sola de los grupos donde no tiene deuda viva en ninguna dirección (mismo predicado); donde la tiene queda como «Cuenta borrada» con sus importes intactos.
- **Borrar el grupo** (creador, `MenuDeGrupo`): tombstone para todos; el modal lista los saldos abiertos antes de confirmar.

Roster: `miembros: {userId: {estado, at}}` se une por clave (gana el `at` mayor) y `memberIds` es derivado (`roster.ts`). Irse no borra los gastos de quien se fue: siguen ahí para los demás.

## 8 · Traspaso a grupo nuevo — `groupCarryOver.ts`, `groupTraspaso.ts`

Un grupo avisa a los 350 gastos y bloquea a los 450 (`groupLimits.ts`, techo del sobre). Traspasar crea un grupo nuevo con el mismo roster y **un `Expense` de traspaso por moneda con saldo**: los acreedores netos como `payers`, los deudores netos como `splits`. El viejo queda archivado de forma irrevocable y sus recurrentes se mueven al nuevo. Traslada el **neto**; como nadie sale con deuda viva, el neto y el par coinciden y no hace falta más.

## 9 · Recurrentes — `recurrence.ts`, `materializeRecurring.ts`

Plantillas con `frequency` semanal/quincenal/mensual/anual ancladas a `startDate` (el 31 cae al 28 en febrero y vuelve al 31). Al abrir la app se materializan TODOS los vencimientos posteriores a `lastMaterializedAt` (recuperación tras meses cerrada), con id determinista `rec_<plantilla>_<vencimiento>` y `updatedAt` = vencimiento (un borrado siempre le gana a una regeneración). Una plantilla sin grupo produce `PersonalEntry`; con grupo produce `Expense`.

## 10 · Personal y presupuesto — `personalMonth.ts`, `entryOrigin.ts`

Movimientos `expense` / `income` (manuales, editables), `group_replicated` (derivado de un gasto de grupo que pagué yo: **lo que salió de mi bolsillo**, ADR-006 d3) y `carryover` (sobrante o excedido del mes anterior, generado al cruzar de mes). Gastado = `expense + group + carryover negativo`; disponible = `presupuesto + income + carryover positivo (+ lo que me deben si el usuario lo prende)`. Los derivados no se editan.

Regla de la réplica (ADR-006 d3, tickets de la auditoría H-2..H-5): la réplica sigue al gasto en crear, editar, borrar y restaurar, y vale **lo que puse yo** (`payers[me].amount`); un pago que hago entra como gastado y uno que recibo como ingreso.

## 11 · Conversión para mostrar — `services/fx.ts`

Cotizaciones de `open.er-api.com` (base USD, 9 monedas, cache con techo de 24 h). `convertMinor` devuelve `null` cuando no puede convertir y la pantalla lo informa (`unconverted`), nunca suma 0. Con una sola moneda en uso no sale a la red.
