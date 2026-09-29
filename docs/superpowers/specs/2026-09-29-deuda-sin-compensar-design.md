# Deuda sin compensar dentro del grupo (T-225) — diseño

**Estado:** BORRADOR para el PO · 2026-09-29
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
| Total de Grupos (pie de la lista) | neto | sin cambios (es el neto) |

## Decisiones que necesito del PO

1. **Amigos.** Los casilleros Te deben / Debés de Amigos, ¿también sin compensar? Y en la
   fila de cada persona, si los dos se deben algo, ¿mostrar las dos cifras? *Recomiendo sí a
   las dos: si no, Amigos contradice a Personal.*
2. **Reglas que hoy usan «saldado» = neto 0:**
   - Botón Saldar visible, «todo saldado», salir o expulsar con saldo (T-181): pasan a mirar
     la deuda bruta (tengo deuda viva si **debo** algo, aunque me deban más). *Recomiendo sí.*
   - **Traspaso a grupo nuevo (T-058):** hoy traslada el neto de cada uno. Con el modelo nuevo
     tendría que trasladar las dos direcciones de cada par. *Recomiendo hacerlo en una
     segunda etapa (T-226), porque toca el alta del grupo nuevo; mientras tanto el traspaso
     sigue trasladando el neto.*
3. **Datos que ya existen.** Si en algún grupo se saldó el neto con el modelo viejo (por
   ejemplo pagaste 80 para cerrar 140 contra 60), con la regla nueva van a reaparecer
   «Te deben 60 · Debés 60». No hay usuarios reales todavía, así que *recomiendo no migrar
   nada*: sólo afecta datos de prueba.

## Cómo se construye (TDD)

1. `src/algorithms/deudasDelGrupo.ts` + tests: el caso del PO, varios pagadores, pagos
   parciales y justos, varias monedas, miembros que salieron, gastos borrados, y la propiedad
   del invariante.
2. Selectores (`useGroupsTotalBalance`, `useDirectedDebts`, y Amigos si el PO dice que sí)
   pasan a usarla. Tests de pantalla con el caso del PO en Grupos y Personal.
3. Saldar usa la deuda del par; tests de sugerido, máximo y modo «todo».
4. Detalle de grupo: widget arriba y balance abajo; tests de qué se muestra y dónde.
5. Enmienda de ADR-006.
