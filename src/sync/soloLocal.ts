import type { Expense, User } from '@/src/types/models';

/**
 * Campos que NO salen al cable, y por qué cada uno.
 *
 * No es una optimización de tamaño: son datos que **no significan nada en el
 * otro teléfono**, y mandarlos es entre inútil y una fuga.
 *
 * - **`Expense.receiptImageUri`** — un path `file:///` del aparato del emisor.
 *   En el teléfono del que lo recibe ese archivo no existe, así que el dato es
 *   inservible; y de paso publica la estructura del filesystem local a todo el
 *   grupo. Ya estaba clasificado `'fuera'` del núcleo firmable
 *   (`recordCore.ts`) con esa misma razón escrita — pero viajaba igual.
 * - **`User.avatarUrl`** — la URL del CDN del proveedor. El propio modelo la
 *   documenta como «sirve UNA vez, para sembrar `avatar`; después no se usa», y
 *   es cierto: se escribe en tres lugares y **no se lee en ninguno** para
 *   dibujar nada. La foto que se muestra son los bytes de `avatar`. Mandar la
 *   URL le cuenta al que recibe de qué CDN salió, sin darle nada a cambio.
 */
export function sinCamposLocales<T extends Partial<Expense>>(expenses: readonly T[]): T[] {
  return expenses.map(e => {
    if (e.receiptImageUri === undefined) return e;
    const { receiptImageUri: _fuera, ...resto } = e;
    return resto as T;
  });
}

export function sinAvatarUrl<T extends Partial<User>>(users: readonly T[]): T[] {
  return users.map(u => {
    if (u.avatarUrl === undefined) return u;
    const { avatarUrl: _fuera, ...resto } = u;
    return resto as T;
  });
}

/**
 * El recibo es del APARATO, así que un registro que llega sin él no puede
 * borrar el que tenemos.
 *
 * Es la contraparte obligatoria de sacarlo del sobre: `receiptImageUri` vive en
 * el nivel "resto" del merge, que es LWW, así que un entrante sin el campo y
 * con `updatedAt` mayor se lo llevaría puesto. Es exactamente el bug que se
 * arregló hoy con la foto de perfil (`preservarAvatar`), y la razón por la que
 * las dos mitades van juntas: sacarlo del cable sin esto **destruye recibos**.
 */
export function preservarRecibo<T extends Partial<Expense>>(entrante: T, local: T | undefined): T {
  if (entrante.receiptImageUri !== undefined) return entrante;
  if (local?.receiptImageUri === undefined) return entrante;
  return { ...entrante, receiptImageUri: local.receiptImageUri };
}
