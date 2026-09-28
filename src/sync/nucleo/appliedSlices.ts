/**
 * Rebanadas APLICADAS por este dispositivo (T-191, Task 3, spec §2.3 y §7/§8
 * C5(c)) — núcleo puro: no importa stores ni `userScope` (frontera P15).
 * Recibe el puerto de almacenamiento ya resuelto (`adaptador.almacen`), mismo
 * patrón que `sliceLedger.ts` (Task 2) pero del lado RECEPTOR: éste recuerda
 * qué YA SE APLICÓ de cada emisor, no qué YO publiqué.
 *
 * Por qué hace falta (spec §2.3): el chequeo del manifiesto de `drainGroup`
 * comparaba las entradas contra un mapa en memoria de ESE drenaje puntual
 * (`recibidasPorRemitente`). Con publicaciones parciales (Task 2), un cubo
 * que no viajó en ESTA vuelta porque no cambió daría un falso «falta» — el
 * manifiesto declara su digest de siempre, pero nadie lo volvió a mandar.
 * `appliedSlices` es la memoria PERSISTENTE que cierra ese hueco: «esto ya lo
 * tengo, aunque no haya venido hoy».
 *
 * Clave: `(topic, sender, ckey)` — NUNCA sólo `ckey` (misma razón que
 * `sliceLedger`, C5(a)): el `topic` distingue época, y `sender` porque el
 * manifiesto de CADA emisor se cierra sólo con SUS PROPIAS rebanadas (el
 * servidor compacta por `(topic, owner, ckey)`, un cubo de otro emisor con la
 * ckey "parecida" no prueba nada).
 */

export interface AlmacenPort {
  get(k: string): string | undefined;
  set(k: string, v: string): void;
  delete(k: string): void;
}

export type AplicadaEntry = { digest: string; seq: number; senderKey: string };

const SEP = '\u0000';
const entradaKey = (topic: string, sender: string, ckey: string) => `appliedSlices${SEP}${topic}${SEP}${sender}${SEP}${ckey}`;
const indiceKey = (topic: string) => `appliedSlicesIndice${SEP}${topic}`;

type IndiceEntrada = { sender: string; ckey: string };

function leerJson<T>(almacen: AlmacenPort, key: string, esValido: (v: unknown) => v is T): T | null {
  const raw = almacen.get(key);
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return esValido(v) ? v : null;
  } catch {
    return null; // dato corrupto: se trata como ausente (mismo criterio que sliceLedger.ts)
  }
}

function esIndiceEntrada(v: unknown): v is IndiceEntrada {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.sender === 'string' && typeof o.ckey === 'string';
}
function esIndice(v: unknown): v is IndiceEntrada[] {
  return Array.isArray(v) && v.every(esIndiceEntrada);
}
function esAplicadaEntry(v: unknown): v is AplicadaEntry {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.digest === 'string' && typeof o.seq === 'number' && typeof o.senderKey === 'string';
}

function leerIndice(almacen: AlmacenPort, topic: string): IndiceEntrada[] {
  return leerJson(almacen, indiceKey(topic), esIndice) ?? [];
}

/** Última rebanada aplicada de `(topic, sender, ckey)`, o `null` si nunca se aplicó (o se olvidó). */
export function leer(almacen: AlmacenPort, topic: string, sender: string, ckey: string): AplicadaEntry | null {
  return leerJson(almacen, entradaKey(topic, sender, ckey), esAplicadaEntry);
}

/**
 * Registra que la rebanada `ckey` de `sender` se aplicó con este
 * `digest`/`seq`/`senderKey`. **Sólo se llama cuando la aplicación no dejó
 * descartes por dependencia** (spec §8, C2) — `drainGroup` es quien decide
 * eso; este módulo sólo persiste lo que le piden.
 */
export function registrar(
  almacen: AlmacenPort,
  topic: string,
  sender: string,
  ckey: string,
  entry: AplicadaEntry,
): void {
  almacen.set(entradaKey(topic, sender, ckey), JSON.stringify(entry));
  const indice = leerIndice(almacen, topic);
  if (!indice.some(e => e.sender === sender && e.ckey === ckey)) {
    indice.push({ sender, ckey });
    almacen.set(indiceKey(topic), JSON.stringify(indice));
  }
}

/**
 * ¿Una entrada del manifiesto está cumplida? (spec §7/§8 C5(c)):
 *  - su `ckey` llegó EN ESTE DRENAJE con el digest declarado, o
 *  - ya estaba aplicada con el MISMO digest, o
 *  - ya estaba aplicada con `seq` MAYOR que el del manifiesto — una
 *    publicación en curso que la cuota cortó a mitad de camino: el emisor
 *    mandó una versión más nueva de ESTE cubo después de generar este
 *    manifiesto viejo, así que lo que hay aplicado es correcto igual.
 *
 * En los dos casos de "ya aplicada" hace falta además que la `senderKey` del
 * cubo aplicado coincida con la del manifiesto — `sender` (el id de cuenta)
 * no está autenticado (ADR-007 §8.1); la clave de firma sí.
 */
export function entradaCumplida(
  entry: { ckey: string; digest: string },
  seqManifiesto: number,
  senderKeyManifiesto: string,
  recibidaEsteDrenaje: string | undefined, // digest del json recibido esta vuelta, si vino
  aplicada: AplicadaEntry | null,
): boolean {
  if (recibidaEsteDrenaje !== undefined && recibidaEsteDrenaje === entry.digest) return true;
  if (!aplicada || aplicada.senderKey !== senderKeyManifiesto) return false;
  if (aplicada.digest === entry.digest) return true;
  return aplicada.seq > seqManifiesto;
}

/**
 * Olvida TODO lo aplicado de un `topic` — borrar el grupo o cambiar su clave
 * (spec §8 C5(c)/(d)): sin esto, un manifiesto futuro con las MISMAS ckeys
 * (mismo grupo, época vieja resucitada por error, o simple coincidencia de
 * digest tras un `[]`) se daría por cumplido contra aplicaciones de un
 * mundo que ya no existe localmente.
 */
export function olvidarTopic(almacen: AlmacenPort, topic: string): void {
  for (const { sender, ckey } of leerIndice(almacen, topic)) {
    almacen.delete(entradaKey(topic, sender, ckey));
  }
  almacen.delete(indiceKey(topic));
}
