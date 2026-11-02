# Moderación: de una denuncia al baneo (T-238)

La denuncia llega por mail a `MAIL_SOPORTE` (T-235). Trae el nombre del autor,
el texto, el id del gasto y una línea **`Autor: <id>`**: el id del autor en la
app. Ese id no es el UUID de Supabase Auth; hay que traducirlo.

## 1 · Encontrar al usuario de Supabase

SQL Editor del proyecto, con el id de la línea `Autor:`:

```sql
-- Cuenta de Google o Apple: el id de la app es el `sub` del proveedor.
select user_id, provider, email from auth.identities where provider_id = '<id>';

-- Invitado: la app guarda su id en los metadatos de la sesión anónima.
select id, created_at from auth.users where raw_user_meta_data ->> 'app_id' = '<id>';
```

Una cuenta puede tener dos filas (Google y Apple con el mismo mail): es el mismo
`user_id`.

## 2 · Banear

Authentication → Users → buscar el UUID → **Ban user** (duración larga). O por SQL:

```sql
update auth.users set banned_until = 'infinity' where id = '<uuid>';
```

## Qué hace y qué no hace

- Desde que vence su token (≤ 1 h) no puede renovar la sesión: deja de publicar
  y leer en el buzón, así que su contenido nuevo no llega a nadie.
- **No borra** lo que ya publicó: el contenido está cifrado y el servidor no puede
  abrirlo. Quien denunció ya lo tiene oculto si lo bloqueó (T-235).
- **Un invitado puede volver a entrar** borrando los datos de la app: es otra
  sesión anónima y otro id. El captcha (Turnstile) encarece el intento, pero no
  lo impide.
- Los invitados cuya sesión anónima se abrió antes de T-238 no tienen `app_id`.
  No hay usuarios reales anteriores a ese cambio.
