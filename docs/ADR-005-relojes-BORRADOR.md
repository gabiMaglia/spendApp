# ADR-005 (BORRADOR) — Relojes: cómo dejar de depender de la hora del teléfono

**Estado:** BORRADOR — investigado, **sin decidir**. La decisión la toma el PO.

## El problema

Todo el merge del proyecto es Last-Write-Wins por `updatedAt`, y `updatedAt` es
`Date.now()` del teléfono que escribió.

Consecuencia: **un dispositivo con la hora adelantada gana TODOS los conflictos**,
y los gana hasta que el tiempo real lo alcance. Si alguien tiene el reloj en 2030
—a mano, por zona horaria mal configurada, o porque el teléfono se reseteó— sus
versiones pisan las de todos los demás durante años, en silencio. Nadie ve un
error: simplemente las ediciones de los otros "no se guardan".

Hoy hay un desempate determinista por contenido canónico (`src/store/lww.ts`),
pero eso resuelve el empate EXACTO, no el desfase.

## Lo que ya tenemos a favor

La mayoría de las apps local-first no tienen ningún reloj confiable. Nosotros sí:
**el relay estampa `created_at` del lado del servidor en cada sobre**, y ese dato
ya llega al cliente (`fetchSince` lo selecciona). Es un reloj único para todos los
dispositivos, y no cuesta nada obtenerlo — ya está viajando.

## Las opciones

### A. Hybrid Logical Clock (HLC)

La respuesta canónica de la literatura. `updatedAt` deja de ser un número y pasa a
ser `(wallclock, contador, nodeId)`: el wallclock es el mayor entre el local y el
mayor visto en cualquier mensaje recibido; el contador desempata; el nodeId
desempata lo que quede. Funciona **totalmente offline** y da causalidad de verdad.

**Costo real, medido:** `updatedAt` aparece **225 veces en 33 archivos** de
producción, más los tests, más el backup exportado, más los registros ya
persistidos en los teléfonos del PO. Es una migración de todo el modelo de datos.

### B. Corregir el reloj local contra el del relay

Se guarda un desfase (`created_at` del servidor − hora local al momento de leerlo)
y se escribe `updatedAt` con la hora corregida. Un único helper `syncedNow()`
reemplaza a `Date.now()` en los puntos de escritura; `updatedAt` sigue siendo un
número y **nada más del sistema cambia**.

Convierte "equivocado para siempre" en "equivocado hasta el primer sync".

**Lo que NO arregla, y hay que decirlo:** no da causalidad. Dos personas editando
el mismo gasto sin haberse sincronizado se siguen resolviendo por timestamp, y
gana el que escribió después según el reloj corregido. Para una app de gastos
entre 2 y 6 personas eso es exactamente lo que uno espera que pase; para un editor
colaborativo no alcanzaría.

### C. No hacer nada

El desempate por contenido ya evita la divergencia permanente ante empates
exactos. El riesgo del reloj queda anotado y se acepta.

## Recomendación (a discutir)

**B.** El problema concreto que tiene este proyecto es "un teléfono con la hora
mal gana siempre", y B lo cierra con un helper y un valor persistido, apoyándose
en un reloj confiable que ya está llegando gratis. A es más correcto en abstracto
y su costo —225 puntos de cambio y migrar todos los registros existentes— es
desproporcionado frente al beneficio que agrega **para esta app**: causalidad
entre pocos participantes que además se sincronizan cada 20 segundos.

Si el proyecto alguna vez apunta a edición colaborativa fina, A es el camino y
conviene hacerlo antes de que haya usuarios reales.

## Lo que habría que verificar antes de cerrar

1. Que el desfase se pueda obtener sin una lectura extra (debería: `created_at`
   ya viene en cada drenaje).
2. Qué hacer en un dispositivo que **nunca** habló con el relay: sin referencia,
   `syncedNow()` es `Date.now()` y estamos como hoy. ¿Se avisa? ¿Se acepta?
3. Si conviene **detectar y avisar** un desfase grande (p.ej. > 5 minutos) en vez
   de sólo corregirlo en silencio — un teléfono con la hora mal también muestra
   fechas de gastos equivocadas, y eso ningún offset lo arregla.
