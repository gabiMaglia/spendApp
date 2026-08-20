# ADR-004 — La identidad criptográfica es de la CUENTA, no del aparato

**Estado:** aceptado (PO, 2026-08-19) · **Reemplaza:** el roster TOFU de T-033, retirado en `dff4815`

## El problema

La identidad que firma los sobres del relay es un par Ed25519 guardado en el
dispositivo. Eso hace que **cambiar de teléfono, reinstalar la app o restaurar
un backup produzcan una identidad nueva**, indistinguible de la de un impostor.

El primer intento fue fijar la identidad al primer uso (TOFU). Se retiró porque
vigilaba el campo equivocado: ataba el SOBRE a una clave, pero `createdById` y
`paidById` son datos adentro del sobre y el merge no los verifica. Se comprobó
ejecutándolo — un miembro puede fabricar un gasto a nombre de otro y se aplica.
Costaba una rotura silenciosa del caso multi-dispositivo a cambio de nada.

## La decisión

**Un directorio de claves públicas por cuenta, autenticado por el mismo login
que ya usa la app.**

Se activa **Supabase Auth con Google y Apple** —los mismos proveedores del
login actual— y se agrega una tabla `device_keys`. Cada dispositivo registra
**su propia** clave pública bajo la cuenta de quien está logueado. La RLS ata
esa escritura al token OAuth, así que **nadie puede registrar una clave bajo la
cuenta de otro**.

Tres cosas que NO cambian, y son las que hacen que esto sea aceptable:

1. **La clave privada no se mueve nunca.** Cada aparato genera la suya y publica
   sólo la pública. No hay que sincronizar secretos ni pedirle una contraseña al
   usuario.
2. **El login de la app sigue siendo el de hoy.** Supabase Auth se usa para
   firmar el acceso al directorio, no para decidir quién entra a la app. Si
   falla, la app funciona igual — como ya pasa cuando el relay no está.
3. **No se viola la regla de privacidad del PO.** El servidor ve
   `cuenta ↔ clave pública`. Eso es "cuentas", que el PO declaró explícitamente
   fuera del alcance de la privacidad que le importa. Los gastos siguen cifrados
   con claves que el servidor no tiene.

## Por qué no las alternativas

- **Mover la clave privada entre dispositivos** (en el backup, o cifrada en la
  nube): obliga a manejar un secreto de usuario —contraseña o passphrase— que
  hoy no existe, y a que el backup pase a ser material sensible. Se descartó.
- **Roster firmado por el creador del grupo**: exige que todos conozcan su clave
  antes del primer sync, y eso sólo se consigue en persona. El PO puso como
  requisito duro que NO se puede pedir presencia física.
- **Confianza al primer uso (TOFU)**: es lo que se retiró. Ver arriba.

## El detalle que condiciona el diseño

El `accountId` de la app **es el `sub` del proveedor** con el que se creó la
cuenta (el de Google o el de Apple, el que haya llegado primero), y el enlace de
cuentas puede dejar como canónico el de un proveedor mientras el usuario entra
con el otro.

Supabase guarda en `auth.identities` un `provider_id` por cada proveedor
vinculado al usuario. La política se apoya en eso: se puede escribir una clave
bajo `account_id` **si ese id es el `provider_id` de alguna de las identidades
de quien está autenticado**. Así el caso "cuenta canónica de Apple, sesión de
Google" funciona, siempre que Supabase haya vinculado las dos identidades.

**Borde conocido y no resuelto:** si Supabase NO vincula las dos identidades
—porque los mails difieren, típico con el relay privado de Apple— una sesión de
Google no va a poder registrar bajo el `accountId` de Apple. Se detecta (la
escritura falla) y por ahora se degrada a no registrar; no se inventa una
vinculación que el servidor no puede probar.

**Este borde es MÁS probable de lo que parecía** (verificado 2026-08-20): Apple
manda el claim `email` dentro del `identityToken` **sólo en la primera
autorización**; en los ingresos siguientes puede no venir. Para que la sesión no
se rechace hay que habilitar *Allow users without an email* en el proveedor
Apple — pero un usuario sin mail es justamente uno que Supabase no puede
vincular por mail con su identidad de Google. O sea: la opción que hace que el
login funcione es la misma que hace más probable que las identidades queden
separadas.

Implicancia para la **fase B**: el lector conoce el `accountId` del autor, no
sus otros `provider_id`. Antes de exigir verificación hay que resolver cómo se
publica y se encuentra la clave de alguien cuya cuenta canónica es de un
proveedor y su sesión de otro. Está sin diseñar, y es lo primero a mirar cuando
se abra la fase B.

## Despliegue en dos fases, a propósito

No se puede empezar a exigir firmas verificadas contra el directorio el mismo
día: hasta que los dispositivos no hayan registrado su clave, exigirlo
rechazaría a todo el mundo.

- **Fase A** — cada dispositivo registra su clave. No se verifica nada todavía.
  Todo sigue funcionando exactamente igual que hoy.
- **Fase B** — se verifica el sobre contra las claves registradas de quien dice
  mandarlo, y se rechaza lo que no coincide.

**Fase B no se activa hasta que el PO confirme** que sus dispositivos aparecen
registrados en la pantalla de diagnóstico.

## Lo que esto habilita

**T-041 — firmar cada registro con la clave de su autor**, que es lo único que
realmente impide fabricar un gasto a nombre de otro. Sin identidad por cuenta no
se puede: la firma de un gasto dejaría de validar en cuanto su autor cambie de
teléfono.

## Configuración que depende del PO

Está en `supabase/003_device_keys.sql` (el SQL) y en la sección de abajo (el
panel). Sin eso, la Fase A no registra nada y la app sigue funcionando como hoy.

### Panel de Supabase → Authentication → Providers

**Google** — habilitar, y:
- *Client IDs*: el **Web client ID** de Google Cloud (el mismo valor que ya está
  en `EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB`).
- *Skip nonce check*: **activado**. El SDK nativo de Google no manda nonce y
  Supabase lo exige por defecto; sin esto el login al directorio falla siempre.
- *Client Secret*: no hace falta. Es sólo para el flujo web.

**Apple** — habilitar, y:
- *Client IDs*: el **bundle id** de la app (y las variantes de dev/preview si se
  usan). No hace falta secret para el flujo nativo.
