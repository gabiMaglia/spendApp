# src/sync — sincronización cifrada por buzón tonto

Mapa de carpetas (spec `docs/superpowers/specs/2026-09-28-sync-extraible-design.md` §3):

| Carpeta | Qué es |
|---|---|
| `nucleo/` | Protocolo puro: sobre, topic/ckey, cubos, ledger, manifiesto. Sin la app. |
| `puertos/` | Sólo tipos: lo que el núcleo/motor pide y la app provee. |
| `motor/` | Cuándo y en qué orden se sincroniza un grupo (poll, publicar, drenar). |
| `adaptadores/supabase/` | El puerto Transporte implementado sobre Supabase. |
| `adaptadores/hushsplit/` | El puerto Documento: qué es un grupo en esta app. |
| `sesion/` | Con qué credencial se habla con el buzón (Supabase Auth). |
| `confianza/` | Quién escribió cada registro (firma por registro, T-041). |
| `contactos/` | El buzón personal de cada persona (tarjeta, claves, QR). |
| `invitaciones/` | Cómo entra alguien a un grupo (link, grant, clave envuelta). |
| `avisos/` | Lo que el sync le cuenta a la persona (bandeja, una vez por hecho). |

## Cómo leer este directorio

1. `motor/README.md` primero — es el punto de entrada conceptual (qué
   resuelve, modelo de amenaza, cómo funciona) y también el README del
   futuro paquete `@hushsplit/relay-sync`.
2. `nucleo/README.md` y `puertos/README.md` — el protocolo y su contrato.
3. `adaptadores/supabase/` y `adaptadores/hushsplit/` — las dos
   implementaciones concretas de los puertos Transporte y Documento.
4. El resto (`sesion/`, `confianza/`, `contactos/`, `invitaciones/`,
   `avisos/`) es capa de producto de HushSplit sobre el motor.

## Núcleo, adaptador, producto

- **Núcleo** (`nucleo/`, `puertos/`, `motor/`): la parte extraíble a un
  paquete reusable en otra app. No conoce el modelo de datos de HushSplit.
- **Adaptador** (`adaptadores/*`): implementa un puerto para ESTA app
  (Supabase como transporte, gastos/pagos como documento). Otra app cambia
  el adaptador, no el núcleo.
- **Producto** (`sesion/`, `confianza/`, `contactos/`, `invitaciones/`,
  `avisos/`): lógica de negocio de HushSplit que usa el motor pero no
  migra a ningún paquete (salvo `contactos/`/`confianza/deviceKeys.ts`,
  candidatos a un segundo paquete `@hushsplit/contact-keys` — ver sus
  propios README, sección «hacia contact-keys»).
