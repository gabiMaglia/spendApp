/**
 * **Código legible de un error de Google Sign-In** (T-138, PO 2026-09-26).
 *
 * El login mostraba siempre el mismo "no se pudo iniciar sesión" y se tragaba
 * la causa, así que no había forma de saber si faltaba un SHA-1, si Play
 * Services estaba viejo o si era la red. Esto arma el texto corto que se
 * muestra entre paréntesis en el aviso.
 *
 * En Android la librería devuelve los códigos de `CommonStatusCodes` /
 * `GoogleSignInStatusCodes` como texto numérico ("10", "12500"…); se les pone
 * nombre a los que importan para diagnosticar.
 */
const NOMBRES: Record<string, string> = {
  // App no registrada para ese paquete + SHA-1 en Google Cloud (el caso T-138).
  '10': 'DEVELOPER_ERROR',
  '7': 'NETWORK_ERROR',
  '8': 'INTERNAL_ERROR',
  '12500': 'SIGN_IN_FAILED',
  '12501': 'SIGN_IN_CANCELLED',
  '12502': 'SIGN_IN_CURRENTLY_IN_PROGRESS',
};

export function codigoDeErrorGoogle(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === undefined || code === null || code === '') return 'UNKNOWN';
  const texto = String(code);
  const nombre = NOMBRES[texto];
  return nombre ? `${nombre} · ${texto}` : texto;
}
