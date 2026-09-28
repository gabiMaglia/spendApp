# Log de re-renders (DEV-ONLY, T-215)

Cómo prenderlo:
- Switch **"Log de renders (dev)"** en `app/debug/identity.tsx` (sólo visible con `__DEV__`), o
- variable de entorno `EXPO_PUBLIC_RENDER_LOG=1` al levantar el bundler.

Cómo leer el log: cada 2 s, una línea por componente que re-renderizó desde el
último volcado, con el motivo (qué dep de las pasadas al hook cambió):

```
[renders] Detalle de grupo: 3 (expenses×1, group×2)
[renders] Fila de grupo: 12 (group×12)
```

Sin paréntesis si no se pasaron `deps` al hook: `[renders] Grupos: 1`.

Qué es normal: 1 render al entrar a la pantalla, y 1 más por cada cambio que
sea realmente suyo (tipear un monto, cambiar de tab, un dato del grupo que
se está viendo). Filas (`GroupRow`/`EventRow`) cuentan agregado POR TIPO, no
por fila individual — un feed de 100 eventos no vuelca 100 líneas.

Qué NO es normal: un componente re-renderizando por un store AJENO al suyo
(p. ej. la fila de un grupo re-pintando porque cambió OTRO grupo), o un
número que crece sin que el usuario haya tocado nada.

Cero impacto en producción: todo vive detrás de `__DEV__` en
`src/dev/contadorDeRenders.ts` — en un build de producción el módulo entero
es no-op (ni bucket de MMKV, ni `setInterval`).

Para agregar un componente nuevo: `useContadorDeRenders('Nombre en español',
{ dep1, dep2, ... })` en el cuerpo del componente, con lo que ya tenga en
scope. Revisar `engram/09_codemap.md` antes de instrumentar algo que ya
tenga su propio wrapper (para no duplicar la llamada).
