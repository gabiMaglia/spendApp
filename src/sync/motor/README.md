# motor — cuándo y en qué orden se sincroniza un grupo

> **Nota de estado (2026-09-28).** Esta carpeta es hoy parte de la app, no un
> paquete instalable. El README describe el **paquete futuro** `@hushsplit/relay-sync`
> (spec `2026-09-28-sync-extraible-design.md` §5.1 fusionada con
> `2026-09-28-motor-sync-reutilizable-design.md` §7). Todo lo marcado
> **(etapa B, hoy importa la app directamente)** todavía no está inyectado:
> el motor lee `store/groupKeyStore`, `store/authStore`, etc. directo (deuda
> declarada V1/V2/V7/V9/V10, ver `relayFrontera.guard.test.ts`), y `crearMotor()`
> no existe en el código — se llama a `relayEngine.startRelay()` y a las
> funciones de `relaySync.ts` (fachada de `publicar.ts`/`drenar.ts`).

## Qué resuelve

Sincronización local-first **por estado** entre los dispositivos de un grupo, a
través de un servidor **tonto** que guarda sobres cifrados y no puede abrirlos.
Varios dispositivos editan los mismos datos sin servidor propio de aplicación:
cada uno publica el ESTADO de lo que sabe, partido en rebanadas cifradas y
firmadas, en un buzón compartido; los demás lo leen desde su cursor y mergean
con la regla de la app (en HushSplit, last-write-wins por registro).

## Modelo de amenaza

- El servidor **no puede leer** (XChaCha20-Poly1305 con la clave del grupo) ni **fabricar** sobres (firma Ed25519).
- El servidor **sí puede** retener, borrar, reordenar o reenviar sobres viejos. El manifiesto hace visible lo que falta; el merge descarta lo viejo.
- Quien conoce el topic (un miembro o ex miembro de esa época) puede borrar rebanadas ajenas. Eso se ve (manifiesto) pero no se impide.
- **Fuera de alcance: miembros maliciosos.** Quien tiene la clave del grupo puede escribir cualquier cosa. Para eso hace falta firma por registro — en HushSplit la pone `confianza/` (T-041), no el motor.
- La distribución de claves de grupo NO es parte del motor: la app entrega `claveDelGrupo(grupoId)` y rota épocas (en HushSplit, vía `invitaciones/` y `contactos/`).

## Cómo funciona (en una pantalla)

- **Topic** = `SHA-256(hex(clave) : época)`. Sin la clave no se sabe ni dónde mirar.
- Cada campo del documento se corta en **cubos estables por prefijo de id** (16 cubos; con histéresis sube a 256, y nunca baja).
- Cada cubo viaja en un sobre **compactable** por `ckey = SHA-256(hex(clave):ckey:campo:prefijo)`: el buzón guarda sólo la última versión de cada cubo por emisor.
- Sólo se publica un cubo si **cambió su digest** o si pasaron **20 días** (renovación contra el TTL de 30). Además va SIEMPRE un **manifiesto** por emisor con el digest de cada cubo.
- El receptor lee desde su cursor, verifica la firma, descifra, **acota** (la app decide qué es legítimo) y aplica. Recuerda qué cubos ya aplicó.
- Si el manifiesto declara algo que no tiene, relee **una vez** desde 0. Si sigue faltando, lo reporta. El cursor nunca pasa una rebanada retenida por dependencia.
- **Nunca publica un grupo antes de haberlo drenado** al menos una vez desde que entró (evita resucitar lo que el grupo borró mientras no estabas).

## Puertos (firmas de `src/sync/puertos/puertos.ts`, hoy sólo tipos)

```ts
interface Transporte {
  publicar(topic: string, payload: string, o: { ckey?: string; compactable: boolean; signal?: AbortSignal }):
    Promise<{ ok: true; seq: number } | { ok: false; reason: 'not_configured'|'too_large'|'network'|'rate_limited'; detail?: string }>;
  leerDesde(topic: string, cursor: number, o?: { excluirEmisor?: string; limite?: number }):
    Promise<{ ok: true; sobres: Sobre[]; cursor: number; hayMas?: boolean } | { ok: false; reason: 'not_configured'|'network'; detail?: string }>;
  borrarMios(topic: string): Promise<{ ok: true; borrados: number } | { ok: false; reason: string; detail?: string }>;
  suscribir(topic: string, alAviso: () => void, alEstado?: (sano: boolean) => void): () => void;
  readonly maxPayloadBytes: number;
}
interface Almacen { get(k: string): string | undefined; set(k: string, v: string): void; delete(k: string): void }
interface Identidad {
  emisor(): string;
  firmar(sellado: string): string;                    // nunca la privada (spec §7.6 fila 8)
  claveDelGrupo(grupoId: string): { clave: Uint8Array; epoch: number } | null;
  sesion(): string | null;
  verificarEmisor?(grupoId: string, autor: string, clavePublica: string): Promise<'ok' | 'descartar'>;
}
interface Documento {                                  // versión del orquestador, concedida para B (spec §7.6 fila 10)
  campos: readonly string[];                            // en orden de DEPENDENCIA
  armar(grupoId: string, ctx: { emisor: string }): Promise<Record<string, { id: string }[]>>;
  aplicar(grupoId: string, campo: string, registros: unknown[]): Promise<{ porTope: number; porDependencia: number }>;
  excede?(registro: unknown): string | null;
  codec?: { envolver(campo: string, regs: { id: string }[]): unknown; desenvolver(x: unknown): { campo: string; registros: unknown[] }[] };
}
interface Cripto { sha256Hex(s: string): Promise<string>; aleatorio(n: number): Uint8Array }
interface Reloj { ahora(): number; ceder(): Promise<void>; alVolverAPrimerPlano?(fn: () => void): () => void }
interface Log { error(mensaje: string, e?: unknown): void }
interface Avisos { publicacion?(g: string, r: unknown): void; manifiesto?(g: string, faltan: string[]): void; aplicado?(g: string, n: number): void }
```

**Contrato de `aplicar`:** idempotente y conmutativo por registro: el mismo
cubo puede llegar dos veces, o una versión vieja después de una nueva.
`porDependencia > 0` significa «esto referencia algo que todavía no tengo»: el
motor lo retiene y lo reintenta al final del drenaje; el cursor no lo pasa.
**Contrato de `Almacen`:** síncrono y ya separado por cuenta; el paquete no
sabe de cuentas.

## Ejemplo de integración (etapa B, hoy importa la app directamente)

```ts
import { crearMotor } from '@hushsplit/relay-sync';               // no existe aún
import { transporteSupabase } from '@hushsplit/relay-sync/supabase';

const motor = crearMotor({
  transporte: transporteSupabase(supabase),
  almacen: { get: k => kv.getString(k), set: (k, v) => kv.set(k, v), delete: k => kv.delete(k) },
  identidad: {
    emisor: () => deviceId,
    firmar: sellado => firmarConMiClave(sellado),
    claveDelGrupo: id => claves.get(id) ?? null,       // { clave: Uint8Array(32), epoch }
    sesion: () => usuarioActual?.id ?? null,
  },
  documento: {
    campos: ['tableros', 'tarjetas', 'comentarios'],
    armar: async id => ({ tableros: db.tableros(id), tarjetas: db.tarjetas(id), comentarios: db.comentarios(id) }),
    aplicar: async (id, campo, regs) => db.mergeLWW(id, campo, regs),
  },
  avisos: { manifiesto: (g, faltan) => faltan.length && console.warn('incompleto', g) },
});

await motor.publicar('tablero-1');
const r = await motor.drenar('tablero-1');
const off = motor.escuchar('tablero-1');
```

**Hoy, en HushSplit**, el equivalente es `relayEngine.startRelay()` (arranca
poll + suscripciones), `relaySync.publishNow(grupoId)` / `drainNow(grupoId)`
(fachada de `publicar.ts`/`drenar.ts`), con el `adaptadorHushSplit` de
`adaptadores/hushsplit/` cumpliendo el rol de `documento` **importado por
nombre**, no inyectado.

## Garantías

- Ningún sobre ajeno se aplica: sin firma válida o sin la clave se descarta antes de tocar los datos.
- El buzón guarda el **estado completo**: la última versión de cada cubo de cada emisor. Quien entra tarde lee desde 0 y ve todo el historial, sin claves viejas.
- El receptor **recuerda** lo que aplicó. Una publicación parcial no da un falso «falta».
- El ledger del emisor registra un cubo **sólo** cuando el servidor lo confirmó. Un envío que venció por tiempo se reenvía.
- Las publicaciones de un mismo grupo se **serializan**. Una vieja no puede pisar a una nueva en la compactación.
- El cursor **nunca retrocede** por debajo de donde arrancó, y nunca pasa una rebanada retenida que todavía tiene reintentos.

## Límites conocidos (no son bugs, son el diseño)

- **TTL 30 días vs renovación a 20 días.** Si ningún miembro abre la app 30 días, el buzón se vacía de a poco. Nadie pierde datos locales, pero quien entre después no ve lo expirado.
- **Dependencia irresoluble.** Una rebanada que tras 3 drenajes sigue referenciando algo que no existe se deja atrás: el cursor la pasa, queda reportada como faltante.
- **Relectura acotada.** A lo sumo una vez por versión de manifiesto de cada emisor. Si sigue faltando, se espera al próximo manifiesto.
- **Emisor silencioso.** Su manifiesto puede sobrevivir hasta 20 días a un cubo vencido; quien entra ve el «falta» y recibe los datos por los demás miembros.
- **Cubo > 256 KB a profundidad máxima:** se rechaza `too_large`.
- **El `sender` no está autenticado por el servidor;** la clave de firma sí. El manifiesto se cierra sólo con cubos firmados por la misma clave.
- **La firma cubre el sobre sellado**, no el `topic`, la `ckey` ni el `seq`. El servidor puede mover un sobre de lugar; no puede hacer que se abra con otro contenido.
- **Orden y reloj:** el merge es de la app. Con LWW por `updatedAt` hace falta un reloj razonable.

## Qué NO incluye

- Distribución y rotación de claves de grupo — en HushSplit, `invitaciones/` y `contactos/`.
- Confianza/firma por registro — en HushSplit, `confianza/` (T-041).
- Autenticación contra el servidor (sesión, captcha) — en HushSplit, `sesion/`; el adaptador de Supabase recibe un cliente ya autenticado.
- UI, notificaciones, i18n, hooks de React — en HushSplit, `avisos/` + `src/hooks/`.
- El modelo de datos: el motor ve `{ id: string }[]` por campo, nada más.

## Comparación honesta con Jazz

Jazz (CoJSON) sincroniza **operaciones** de valores colaborativos (CoValues)
contra un servidor de sync que conserva el historial, con grupos, roles y
permisos resueltos criptográficamente. Este motor sincroniza **estado** por
rebanadas sobre un buzón que olvida (TTL) y deja el merge y los permisos a la
app. Conviene Jazz si arrancás el modelo de cero, querés historial, roles,
reactividad y colaboración fina. Conviene este si ya tenés un modelo con merge
LWW propio, querés un servidor que sólo sea un buzón expirable (cualquier
Postgres, S3 o KV) y aceptás el costo O(tamaño del grupo) al entrar. Ninguno
de los dos protege contra un miembro malicioso que tiene la clave sin firma
por registro del lado de la app (ver `feedback_jazz_referencia_sync.md`).

## Qué podés construir con esto (ideas)

- Lista de compras o tareas compartida entre pocas personas, sin cuenta en un servidor propio.
- Diario o álbum privado de pareja o familia: fotos por referencia con hash (como los avatares de HushSplit, `adaptadores/hushsplit/avatarTopic.ts`).
- Inventario de un club, un grupo scout, una banda: quién tiene qué prestado.
- Presupuesto compartido de un viaje, con el mismo esquema de gastos y pagos.
- Registro de mantenimiento de algo compartido (un auto, un departamento alquilado).
- Cualquier «documento por grupo» de menos de unos miles de registros donde la privacidad importe y el backend no.
- **No sirve tal cual** para una app de «seguir a alguien en un mapa»: ver §7.2 de la spec — falta una pieza **única compactable** (1 sobre por posición) en vez de cubos + manifiesto.

## Sugerencias al integrar

- Diseñá el documento con **ids estables y únicos** (UUID v4) desde el primer día: son la base de los cubos.
- Declarar bien el **orden de dependencia** entre campos evita retenciones: primero lo que otros referencian.
- `documento.excede?` es el lugar para **validar**: tamaño, pertenencia al grupo, autoría. El motor no juzga contenido.
- Empezá con **un transporte en memoria** para tests: el motor no sabe si es Supabase o un array.
- Si la app tiene fotos, mandalas **por referencia** (hash en el registro, blob en otro topic), no dentro del cubo.
- Publicá desde una **cola con debounce** por grupo (HushSplit usa 1,5 s, ver `agendaDePublicacion.ts`) para no mandar un sobre por tecla.

## Versionado y compatibilidad

El **formato de cable** es un contrato entre dispositivos que no se actualizan
juntos. Cambiar cualquiera de estos puntos es **versión mayor**:
- Sobre firmado: `{"v":1,"p":<base64(nonce24‖ciphertext)>,"k":<ed25519 pub hex>,"s":<firma hex sobre p>}`.
- Derivación de `topic` y de `ckey` (SHA-256 sobre el texto exacto descrito arriba).
- Manifiesto: `{"version": 2, "entries": [{"ckey","digest"}]}` (`MANIFEST_VERSION = 2`).
- Profundidad máxima (4) y regla de prefijo (hex del UUID, o `sha256(id)` si no es UUID).
- El `codec` por defecto de las piezas. Si la app pasa su propio `codec`, su formato es contrato suyo.

Agregar un puerto **opcional** o un aviso nuevo es versión menor. Un receptor
que ve un `version` de manifiesto desconocido lo trata como rebanada de datos
y el `codec` la rechaza: no se aplica nada que no se entienda.

## Módulos de hoy (producto, no paquete)

Ciclo de vida: arrancar/parar (`relayEngine`), poll adaptativo 90 s/20 s (`poll`),
debounce de publicación y drenaje (`agendaDePublicacion`, `agendaDeDrenaje`),
cursor por topic (`cursor`), cola con ritmo bajo la cuota (`relayQueue`), guarda
«drenar antes de publicar» (`pendingDrain`, T-089) y diagnóstico de publicación
(`publishHealth`). `publicar.ts` = UNA publicación (cola por topic, timeout,
cubos + manifiesto). `drenar.ts` = UN drenaje (páginas, abrir, aplicar,
retenidas, manifiesto). `relectura`/`chequeoManifiesto`/`claveVigente` = piezas
del drenaje. `relaySync.ts` = ruta pública de publicar/drenar (fachada).
`relayEngine.ts` orquesta TAMBIÉN invitaciones y contactos: es la raíz de
composición de HushSplit, no parte del futuro paquete.
Regla de dirección: fachada → contactos → drain → publish → poll/cursor (T-189).
Depende de: `nucleo/`, `puertos/` (sólo `drenar.ts`), y hoy también de
`store/*`, `services/*`, `adaptadores/`, `confianza/` (deuda declarada). Lo
usan: `avisos/`, `contactos/`, `invitaciones/`, y `store/*`/`services/*` de la app.
Leer: ADR-007 §3-§4, spec 2026-09-28-sync-extraible-design.md §8 (C2 regla del cursor).
Tests: `motor/__tests__` (caracterización del motor + integración con núcleo).
