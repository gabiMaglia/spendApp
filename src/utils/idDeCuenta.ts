/**
 * Forma válida de un id de cuenta (T-124 · SEC L-B).
 *
 * Los ids reales tienen tres orígenes, y sólo tres: el UUID que genera el
 * dispositivo (regla de negocio #5), el id numérico que manda Google, o el id
 * con puntos de Apple (`credential.user`, p. ej. `"001234.abcdef...1234"`,
 * ver `app/auth/index.tsx`). Los tres traen al menos un dígito y ningún
 * carácter fuera de letras/dígitos/`._-`. Un id armado a mano para un link
 * hostil (NUL, RLO, `../x`, `__proto__`) no calza en ninguna de esas formas:
 * `__proto__` en particular no tiene ni un dígito.
 *
 * Vive en su propio módulo, no en `contactLink.ts`: ese archivo ya importa
 * (valores, no sólo tipos) de `linkCompacto.ts`, que también necesita esta
 * función para validar el id que decodifica — ponerla en `contactLink.ts`
 * armaría un ciclo de imports entre los dos.
 */
const RE_ID_CUENTA = /^(?!\.)(?=.*\d)[A-Za-z0-9._-]{1,255}$/;

export function esIdDeCuenta(id: unknown): id is string {
  return typeof id === 'string' && RE_ID_CUENTA.test(id);
}
