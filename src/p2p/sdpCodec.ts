import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

// Señal de pairing WebRTC que viaja en el QR: el SDP (offer o answer) con TODOS
// los candidatos ICE ya incluidos (non-trickle). Se comprime con deflate y se
// codifica en base64 para minimizar el tamaño del QR (los SDP crudos superan la
// capacidad de un QR escaneable; deflate baja ~50-60%).
export interface Signal {
  v: number;                 // versión del formato (forward-compat)
  t: 'offer' | 'answer';
  sdp: string;
}

const SIGNAL_VERSION = 1;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '').replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 6) / 8);
  const bytes = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64.indexOf(clean[i]);
    const c1 = B64.indexOf(clean[i + 1]);
    const c2 = B64.indexOf(clean[i + 2]);
    const c3 = B64.indexOf(clean[i + 3]);
    if (p < len) bytes[p++] = (c0 << 2) | (c1 >> 4);
    if (c2 >= 0 && p < len) bytes[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (c3 >= 0 && p < len) bytes[p++] = ((c2 & 3) << 6) | c3;
  }
  return bytes;
}

/** Serializa una señal a un string compacto (deflate+base64) para el QR. */
export function encodeSignal(type: 'offer' | 'answer', sdp: string): string {
  const sig: Signal = { v: SIGNAL_VERSION, t: type, sdp };
  const compressed = deflateSync(strToU8(JSON.stringify(sig)), { level: 9 });
  return bytesToBase64(compressed);
}

/** Parsea el string del QR de vuelta a la señal. Lanza si es inválido. */
export function decodeSignal(payload: string): Signal {
  let sig: Signal;
  try {
    const bytes = base64ToBytes(payload.trim());
    sig = JSON.parse(strFromU8(inflateSync(bytes))) as Signal;
  } catch {
    throw new Error('sync.pair_invalid_signal');
  }
  if ((sig.t !== 'offer' && sig.t !== 'answer') || typeof sig.sdp !== 'string' || sig.sdp.length === 0) {
    throw new Error('sync.pair_invalid_signal');
  }
  return sig;
}
