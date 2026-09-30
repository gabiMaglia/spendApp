# Política de privacidad — HushSplit

> **BORRADOR TÉCNICO — no publicar sin revisar.**
> Redactado el 2026-09-04 verificando el código, no de memoria: cada afirmación de acá se
> comprobó contra el esquema del relay (`supabase/001_mailbox.sql`, `007_ttl_cron.sql`), el
> armado del sobre (`src/sync/relaySync.ts`), el cifrado (`src/sync/envelopeCrypto.ts`) y los
> permisos del manifest generado.
>
> **No soy abogado.** Esto describe con precisión lo que la app hace; la forma legal —jurisdicción,
> derechos ARCO/GDPR, responsable de tratamiento, plazos formales— la tiene que revisar alguien
> que sí lo sea. Lo que sí garantizo es que **no promete nada que el código no cumpla**, que es
> exactamente el error que esta app ya cometió una vez (la pantalla de privacidad afirmaba tres
> cosas falsas hasta el 2026-09-02).

**Última actualización:** [fecha de publicación]
**Contacto:** gab.maglia@gmail.com

---

## Lo corto

HushSplit funciona **en tu teléfono**. Tus gastos, tus grupos y tus contactos no están en ninguna
base de datos nuestra: viajan **cifrados de punta a punta** entre los teléfonos de tu grupo, a
través de un buzón que no los puede abrir. La llave la tienen los teléfonos, nunca el servidor.

Del lado del servidor guardamos sólo lo necesario para que el buzón reconozca tu cuenta: si entrás
con Google o Apple, **tu mail y tu identificador de cuenta**. Si entrás como invitado, ni eso.
(Corregido el 2026-09-29, auditoría pre-tiendas: este párrafo decía que no teníamos tu mail, y
desde T-147-b la sesión del buzón con Google o Apple lo guarda en Supabase Auth.)

---

## Qué datos existen, y dónde

### En tu teléfono, y sólo ahí
- Tus gastos, grupos, pagos y movimientos personales.
- Tu nombre, tu foto de perfil y tus preferencias.
- Las claves criptográficas de tus grupos y la identidad de tu dispositivo.

Nada de esto se nos envía. Si desinstalás la app sin exportar un respaldo, **se pierde**: no hay
ninguna copia nuestra desde la cual restaurarlo.

El archivo de respaldo (`.hushsplit`) incluye, en claro (sin cifrar), tus datos **y las claves
criptográficas de tus grupos** — es lo que le permite a otro teléfono, con el mismo Google o
Apple, seguir sincronizando después de restaurarlo. Guardalo como algo privado.

### En los teléfonos de la gente de tus grupos
Cuando compartís un grupo, los gastos de ese grupo —y tu nombre y tu foto— **quedan guardados en
el teléfono de cada integrante**. Es lo que hace que la app funcione sin servidor y también que
cada uno pueda ver el historial completo del grupo.

**Esto es importante y no lo podemos deshacer:** una vez que un dato llegó al teléfono de otra
persona, ni vos ni nosotros lo podemos borrar de ahí.

### En nuestro servidor de paso («el buzón»)
Para que dos teléfonos se sincronicen sin estar juntos, la app deja paquetes en un buzón
temporal. De cada paquete se guarda:

| Campo | Qué es |
|---|---|
| `topic` | Una etiqueta **derivada de la clave del grupo**. No dice el nombre del grupo ni quién lo integra. |
| `payload` | El contenido, **cifrado**. La clave nunca sale de los teléfonos, así que para el servidor es ruido. |
| `sender` | Un identificador del dispositivo emisor. **No es tu nombre ni tu mail.** |
| `owner_tag` / `owner_proof` | Una marca que le permite al dispositivo emisor borrar sus propios paquetes (ADR-009). |
| `created_at` / `expires_at` | Cuándo llegó y cuándo caduca. |

**En los paquetes no va tu mail, tu nombre, tu foto ni ningún gasto en claro.**

### Tu cuenta en el buzón (Supabase Auth)
- Con **Google o Apple**: tu mail, tu identificador en ese proveedor y lo que el proveedor incluye
  en el token (con Google, nombre y dirección de la foto).
- Como **invitado**: una cuenta anónima, sin mail ni nombre.
- En los dos casos: la **clave pública** del dispositivo (`device_keys`), para que los grupos
  verifiquen la autoría, y **contadores de uso** por cuenta (`relay_quota*`) para frenar abusos,
  que se borran solos en un día como máximo.

Se usan sólo para que la sincronización funcione: no mandamos mails ni los compartimos.

Los paquetes **se borran solos a los 30 días**, hayan sido leídos o no.

Hay que decir algo más, porque es cierto: el buzón está abierto a la lectura para cualquiera que
conozca el `topic`. Eso significa que quien tiene o tuvo la clave de un grupo puede leer sus
paquetes. **Alguien de afuera no puede**, porque sin la clave el `topic` no se puede adivinar ni
el contenido descifrar.

### Cotizaciones de monedas
Si tenés gastos en **más de una moneda**, la app pide la tabla de cotizaciones del día a un
servicio público de terceros (`open.er-api.com`). Esa llamada **no manda ningún dato tuyo**: pide
la tabla completa del dólar contra todas las monedas, sin decir quién sos ni qué gastos tenés.
Como cualquier pedido a internet, ese servicio ve tu dirección IP.

**Si usás una sola moneda, esa llamada no se hace nunca.**

### Otros terceros
- **Supabase** aloja el buzón y las cuentas del buzón.
- **Cloudflare Turnstile**: si entrás como invitado, una verificación contra bots. Cloudflare ve tu
  IP y datos técnicos del navegador interno de la app.
- **Google**: al entrar con Google, la app descarga una vez tu foto de perfil desde sus servidores.

---

## Iniciar sesión

Podés entrar con Google, con Apple o como invitado. Con Google o Apple llegan tu **identificador
de proveedor**, tu **mail** y —si lo compartís— tu **nombre y foto**. Se guardan en tu teléfono, para
saber que sos vos y para juntar tus cuentas si entrás con las dos, y el identificador y el mail
quedan además en la cuenta del buzón (ver arriba). No los usamos para contactarte.

---

## Permisos que pide la app, y para qué

| Permiso | Para qué | Cuándo |
|---|---|---|
| **Cámara** | Escanear el QR de un contacto y sacarle la foto a un recibo | Sólo cuando tocás esas funciones |
| **Fotos** | Elegir tu foto de perfil, con el selector del sistema (en Android no pide permiso de galería) | Sólo al elegirla |
| **Notificaciones** | Avisarte de gastos nuevos, comentarios, pagos, restauraciones e invitaciones. **Se generan en tu teléfono**, no las manda un servidor | Si las aceptás |
| **Internet / estado de red** | Dejar y buscar paquetes en el buzón | Al sincronizar |

**La app NO pide micrófono, NO pide Bluetooth y NO pide ubicación.** La librería de conexión que
usamos los traía de fábrica porque sirve también para videollamadas; los bloqueamos a propósito
y hay un test automático que falla si vuelven.

---

## Lo que NO hacemos

- **No hay publicidad** y no hay identificadores de publicidad.
- **No hay analítica**: no medimos qué pantallas ves ni cuánto usás la app.
- **No vendemos ni compartimos datos con nadie.** No hay con quién: no los tenemos.
- **No hay rastreo entre apps.**

---

## Borrar tu cuenta

Desde **Yo → Borrar cuenta** se borra, de tu teléfono:

- todos tus gastos, grupos, pagos y movimientos personales;
- tu perfil, tus preferencias y tus claves;
- el vínculo entre tus cuentas de Google y Apple, si lo habías hecho.

Y del buzón se sacan **los paquetes que dejó este teléfono** y **tu cuenta del buzón** (mail,
identificador, clave pública y contadores; `supabase/012_borrar_mi_cuenta.sql`), en el momento. Si
no hay internet, se completa la próxima vez que abras la app con conexión. Si ya no tenés la app,
se pide por mail desde la cuenta y se borra a mano en un máximo de 30 días.

**Lo que ese botón no puede borrar, y hay que decirlo claro:**

1. **Los gastos que ya están en el teléfono de tus grupos.** Son la contrapartida de deudas de
   otras personas: borrarlos les rompería las cuentas a ellos. Van a seguir viendo esos
   movimientos. Tu **nombre y tu foto sí desaparecen**: al borrar la cuenta se avisa a tus grupos,
   y la próxima vez que sincronicen vas a figurar como «Cuenta borrada».
2. **Los paquetes que dejó otra instalación de la app.** Si reinstalaste, o si tenías la app en
   otro teléfono, esos paquetes ya no se pueden sacar desde acá: la llave que prueba que son tuyos
   vive en el teléfono que los dejó. **Caducan solos a los 30 días**, como todos.

**Período de retención adicional:** los paquetes cifrados del buzón se borran solos **a los 30
días** de haber llegado, se hayan leído o no. Es el único dato que sobrevive al borrado de la
cuenta fuera de los teléfonos de tus grupos, y no lo podemos leer.

**Si tenías deudas abiertas**, borrar la cuenta no las cancela: los movimientos que las respaldan
siguen en los teléfonos de tu grupo. No los podemos borrar y no los borramos — son la cuenta de
otra persona.

Si ya no tenés la app, escribinos a gab.maglia@gmail.com **desde el mail de tu cuenta** de Google o
Apple: borramos tu cuenta del buzón (mail, identificador, clave pública y contadores) en un máximo
de 30 días y te avisamos. Lo que está en tu teléfono o en los de tus grupos no lo podemos tocar.

---

## Cambios

Si esto cambia, cambia también la fecha de arriba. Si el cambio afecta a qué sale de tu teléfono,
lo vas a ver dentro de la app antes de que pase.

---

## Preguntas

gab.maglia@gmail.com
