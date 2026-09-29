# Deuda sin compensar dentro del grupo (T-225) — diseño

**Estado:** DECISIONES DEL PO TOMADAS · 2026-09-29
**Enmienda:** ADR-006, decisión 1 («saldar es direccional»), que ya prohibía compensar entre
grupos pero seguía compensando DENTRO de cada grupo (`simplifyDebts` por grupo,
`src/store/selectors.ts:188`).

## El problema (reportado por el PO en el Moto)

Un grupo, dos personas, cinco gastos: en cuatro me deben (200 en total) y en uno debo 60.
Hoy se ve **Te deben 140 · Debés 0**. Los 60 que debo desaparecen porque el saldo del grupo
es un neto. Lo mismo en Personal.

## La regla nueva (palabras del PO)

- Lo que me deben y lo que debo se muestran **por separado**, nunca compensados.
- Cada lado baja **sólo con su propio pago**: si debo 140 y me deben 60 y pago 140, quedan
  **Debés 0 · Te deben 60**. Esos 60 bajan cuando me paguen.
- Se salda **justo o una parte**; nunca de más.
- **Invariante:** Te deben − Debés = el neto de siempre (el total no cambia).

## Cómo se calcula (una función pura, un solo lugar)

`deudasDelGrupo(gastos, pagos, miembros)` → lista de deudas **por par y por moneda**:
`{ deudor, acreedor, moneda, monto ≥ 0 }`, las dos direcciones por separado.

- **Gasto con un pagador:** cada participante que no es el pagador le debe su parte.
- **Gasto con varios pagadores:** la parte de cada participante se reparte entre los que
  pagaron en proporción a lo que puso cada uno, en enteros exactos (la suma cierra al centavo).
- **Pago de A a B:** baja la deuda de A con B. Si alguna vez se pasara (la app no lo permite),
  el excedente queda como deuda de B con A, para que el invariante se cumpla igual.
- Test de propiedad: para cada persona, Σ lo que le deben − Σ lo que debe = su neto de
  `calculateBalancesByCurrency`, en cualquier combinación de gastos y pagos.

## Dónde cambia

| Lugar | Hoy | Nuevo |
|---|---|---|
| Grupos, casilleros Te deben / Debés | neto por grupo | suma de las deudas brutas |
| Personal, Te deben / Debés | neto por persona dentro de cada grupo | ídem, sin compensar |
| **Detalle de grupo, arriba** | balance grande neto | **widget Te deben / Debés sólo de ese grupo** |
| **Detalle de grupo, abajo** | — | **Balance neto debajo del último movimiento, antes de «Traspasar a grupo nuevo», con el estilo del Total de Grupos** (si hay pedido de salida, va entre el balance y el botón) |
| Saldar: monto sugerido y máximo | neto entre los dos | **lo que yo le debo a esa persona**, completo |
| Saldar modo «todo» | acreedores por el neto | cada acreedor por lo que le debo |
| Amigos, casilleros | neto por persona | suma bruta: lo que me deben todos / lo que debo a todos |
| Amigos, tarjeta del contacto | neto global | neto de esa persona (me debe − le debo) |
| Saldar desde Amigos | monto en un solo grupo | **total** de lo que le debo, un pago por grupo compartido |
| Total de Grupos (pie de la lista) | neto | sin cambios (es el neto) |

## Decisiones del PO (2026-09-29)

1. **Amigos.** Casillero *Te deben* = suma de lo que me debe cada amigo; *Debés* = suma de lo
   que le debo a cada uno (sin compensar). La **tarjeta de cada contacto** muestra el balance
   de esa persona: lo que me debe − lo que le debo (neto).
2. **Saldar desde Amigos** = la **totalidad** de lo que le debo a esa persona, sí o sí (sin
   parcial), y cancela lo que le debo **en todos los grupos que compartimos**: se registra un
   pago por grupo, por lo que le debo en ese grupo. **Saldar desde un grupo** cancela sólo lo
   que le debo en ese grupo (ahí sí se puede pagar una parte).
   Reglas de «saldado» (botón Saldar visible, «todo saldado», salir/expulsar con saldo): miran
   si **debo** algo, aunque me deban más (asumido: el PO no objetó la recomendación).
3. **Traspaso a grupo nuevo** con las dos direcciones: queda trackeado como **T-226**; mientras
   tanto traslada el neto.
4. **No hay usuarios reales** (la app no está en producción): sin migración de datos.

## Comparativa con Splitwise

| Tema | Splitwise | HushSplit (decisión del PO) |
|---|---|---|
| Deuda entre dos personas en un grupo | Un solo número por par: se compensa (si le debo 60 y me debe 200, «me debe 140»). | **Sin compensar:** «me debe 200» y «le debo 60», cada uno baja con su pago. |
| «Simplificar deudas» (cadenas A→B→C) | Opcional por grupo, apagado por defecto; nunca cambia el total de nadie. | No se aplica a la deuda; queda sólo como sugerencia (ADR-006). |
| Totales del dashboard (*you owe* / *you are owed*) | Suma de los **netos por amigo**: cada amigo cae de un solo lado. | Suma **bruta**: lo que me deben todos y lo que debo a todos, por separado. |
| Balance por amigo | Un número neto por amigo, en la moneda más grande. | **Igual**: neto por contacto (lo que me debe − lo que le debo). |
| Saldar desde el amigo | Si se paga el total exacto, reparte el pago entre todos los grupos y los deja en cero; un parcial hay que cargarlo a mano por grupo. | **Igual en el total**, pero **sólo total** (sin parcial) y cancela únicamente **lo que yo debo**; lo que me deben queda. |
| Saldar dentro de un grupo | Registra el pago en ese grupo, contra el neto del par. | Registra el pago en ese grupo, contra **lo que le debo** (se puede parcial). |
| Multi-moneda | Balances por moneda; el dashboard muestra la mayor con asterisco. | Por moneda, nunca mezcladas (regla del repo); totales convertidos a la moneda de visualización como hoy. |

**Diferencia de fondo:** Splitwise trata la relación con cada persona como **una cuenta
corriente** que se compensa sola. HushSplit la trata como **dos deudas independientes**:
«saldar» significa «yo no te debo más», no «estamos a mano» (ADR-006, decisión 1). La
consecuencia visible es que dos personas pueden deberse mutuamente a la vez, y cada una lo ve.

## Cómo se construye (TDD)

1. `src/algorithms/deudasDelGrupo.ts` + tests: el caso del PO, varios pagadores, pagos
   parciales y justos, varias monedas, miembros que salieron, gastos borrados, y la propiedad
   del invariante.
2. Selectores (`useGroupsTotalBalance`, `useDirectedDebts`, `useGlobalPersonBalances`) pasan a
   usarla. Tests de pantalla con el caso del PO en Grupos y Personal.
3. Saldar usa la deuda del par; tests de sugerido, máximo y modo «todo». Saldar desde Amigos:
   total obligatorio, un pago por grupo compartido.
4. Detalle de grupo: widget arriba y balance abajo; tests de qué se muestra y dónde.
5. Enmienda de ADR-006.
