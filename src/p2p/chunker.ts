// Framing para enviar payloads grandes por un DataChannel: un mensaje SCTP tiene
// un límite de tamaño (~16-64KB según impl), así que un delta grande no entra en
// un solo send. Partimos el payload en chunks y los reensamblamos del otro lado.
//
// Formato de frame (delimitado por '|', sin JSON para no inflar por escaping):
//   <msgId>|<i>|<n>|<data>
// msgId = uuid (sin '|'), i = índice, n = total, data = trozo (puede contener '|',
// por eso se toma como "el resto" tras el 3er separador).

const CHUNK_SIZE = 16 * 1024; // 16K chars por chunk (conservador para SCTP)

export function toFrames(payload: string, msgId: string, chunkSize: number = CHUNK_SIZE): string[] {
  const n = Math.max(1, Math.ceil(payload.length / chunkSize));
  const frames: string[] = [];
  for (let i = 0; i < n; i++) {
    frames.push(`${msgId}|${i}|${n}|${payload.slice(i * chunkSize, (i + 1) * chunkSize)}`);
  }
  return frames;
}

interface Pending { n: number; parts: (string | undefined)[]; got: number }

/**
 * Reensambla frames en el payload original. Soporta chunks fuera de orden y
 * mensajes concurrentes (por msgId). Devuelve el payload completo cuando llegó
 * el último chunk faltante, o null mientras falten. Ignora frames malformados.
 */
export class Reassembler {
  private pending = new Map<string, Pending>();

  push(raw: string): string | null {
    const p1 = raw.indexOf('|');
    const p2 = raw.indexOf('|', p1 + 1);
    const p3 = raw.indexOf('|', p2 + 1);
    if (p1 <= 0 || p2 < 0 || p3 < 0) return null;

    const msgId = raw.slice(0, p1);
    const i = parseInt(raw.slice(p1 + 1, p2), 10);
    const n = parseInt(raw.slice(p2 + 1, p3), 10);
    const data = raw.slice(p3 + 1);
    if (Number.isNaN(i) || Number.isNaN(n) || n < 1 || i < 0 || i >= n) return null;

    let entry = this.pending.get(msgId);
    if (!entry) {
      entry = { n, parts: new Array(n), got: 0 };
      this.pending.set(msgId, entry);
    }
    if (entry.n !== n) return null; // frame inconsistente para este msgId
    if (entry.parts[i] === undefined) {
      entry.parts[i] = data;
      entry.got++;
    }
    if (entry.got === entry.n) {
      this.pending.delete(msgId);
      return entry.parts.join('');
    }
    return null;
  }

  reset(): void {
    this.pending.clear();
  }
}
