import { CORE_KINDS } from '../recordCore';

/**
 * **`users` NO se firma, y es una decisión auditada** (T-091).
 *
 * El agujero es real y sigue abierto: los perfiles viajan en el sobre y se
 * aplican con `mergeByIdLWW` sin ninguna verificación, así que **cualquiera con
 * la clave de un grupo puede reescribirle el nombre y la foto a cualquier
 * miembro**. Lo que se auditó es si firmarlos lo cierra, y **no lo cierra**:
 *
 *  1. **`avatar` no puede entrar al núcleo.** `preservarAvatar` (T-056)
 *     reescribe el registro DESPUÉS de recibirlo (`src/store/userStore.ts`), así
 *     que una firma que cubriera la foto dejaría de verificar **en el propio
 *     teléfono, para un registro legítimo**, apenas la copia local complete la
 *     imagen. Y el ataque era «el nombre **y la foto**»: la mitad queda sin
 *     cubrir por construcción.
 *  2. **Seis caminos de esta app crean `User` de terceros** —invitación,
 *     tarjeta de contacto, QR escaneado, deep link, contacto a mano y miembro
 *     invitado a un grupo—, y **dos de ellos son para gente que no tiene la app**
 *     (`app/(tabs)/friends.tsx`, `app/groups/[id].tsx`: id `uuidv4()`, sin clave
 *     con qué firmar, jamás). Esos registros quedarían `no_verificable` para
 *     siempre, y como se escriben con `updatedAt` local **pueden ganarle por LWW
 *     a la copia firmada del dueño**: la marca terminaría señalando al inocente.
 *
 * Contra eso choca la regla que gobierna toda la marca de T-041: ***«si todo
 * lleva marca, la marca no dice nada»*** (`src/algorithms/recordTrust.ts`).
 *
 * ⚠️ **Cómo se reabre esto, si algún día hay que reabrirlo.** No borrando este
 * test: leyendo `engram/plans/T-091.md` §3.2 y §3.3 y **tumbando esos dos
 * argumentos con evidencia nueva** — por ejemplo, que los perfiles ya lleguen
 * firmados por sus dueños en un grupo real, o un diseño donde `avatar` quede
 * fuera del núcleo sin dejar el ataque a medias. Recién ahí se agrega `'user'`
 * a `CORE_KINDS`, y **sube `CORE_VERSION`**, que es una migración del formato de
 * todos los registros firmados.
 *
 * Este guard **importa la constante**, no barre texto, así que no puede
 * detectarse a sí mismo. Si alguien lo convierte en un barrido de `src/`, tiene
 * que excluir `__tests__` — al proyecto ya le pasó tres veces
 * (`src/__tests__/noHardcodedCurrency.test.ts`).
 */
describe('el perfil ajeno no se firma, a propósito', () => {
  it('`CORE_KINDS` no incluye `user`', () => {
    const kinds: readonly string[] = CORE_KINDS;

    expect(
      kinds.includes('user')
        ? '`user` entró a CORE_KINDS. Antes de esto hay que tumbar §3.2 y §3.3 de ' +
          'engram/plans/T-091.md: `preservarAvatar` reescribe el registro después de ' +
          'recibirlo (una firma sobre `avatar` no verifica ni en el propio teléfono), y ' +
          'seis caminos crean `User` de terceros — dos de ellos para gente sin app, que ' +
          'nunca va a poder firmar. Y sube CORE_VERSION, que es una migración de formato.'
        : 'sin user',
    ).toBe('sin user');
  });

  it('los cinco que SÍ se firman siguen ahí', () => {
    // El otro lado del guard: que «no firmar users» no se lea nunca como
    // «dejamos de firmar».
    expect([...CORE_KINDS].sort()).toEqual(
      ['comment', 'expense', 'group', 'payment', 'recurring'],
    );
  });
});
