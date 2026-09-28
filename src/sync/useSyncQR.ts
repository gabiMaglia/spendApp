import type { SyncDelta } from './applyDelta';

/** Serializa el delta a string JSON comprimido para el QR. */
export function deltaToQRString(delta: SyncDelta): string {
  return JSON.stringify(delta);
}

/** Parsea el string del QR a un SyncDelta. Lanza si el formato es inválido. */
export function parseDeltaFromQR(raw: string): SyncDelta {
  const data = JSON.parse(raw) as SyncDelta;
  if (data.version !== 1) throw new Error('Versión de sync no soportada');
  return data;
}
