import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  excesoDe, byteLengthUtf8, truncar, admiteUnMiembroMas,
  MAX_TEXTO_CORTO, MAX_NOTA, MAX_MIEMBROS,
} from '../topes';

describe('byteLengthUtf8', () => {
  it('cuenta bytes reales, no unidades UTF-16', () => {
    expect(byteLengthUtf8('abc')).toBe(3);
    expect(byteLengthUtf8('ñ')).toBe(2);
    expect(byteLengthUtf8('😀')).toBe(4);
  });
});

/**
 * Enmienda del PO 2026-09-26 (tras QA+verifier RECHAZADO, ronda 1): recibir y
 * publicar usan el MISMO predicado — sólo bytes (`MAX_REGISTRO_BYTES`) y
 * `memberIds.length > MAX_MIEMBROS`. Los topes de 200/2.000 caracteres dejan
 * de aplicarse acá; quedan sólo en inputs y en textos que genera la app
 * (`truncar`, más abajo).
 */
describe('excesoDe — qué tope viola un registro (ronda 2: sólo bytes + miembros)', () => {
  it('un registro normal no viola nada', () => {
    expect(excesoDe({ id: 'e1', description: 'Cena', note: 'con propina', memberIds: ['a', 'b'] })).toBeNull();
  });

  it('D1 (verifier) — una description/note/name larga YA NO excede ningún tope al medir', () => {
    expect(excesoDe({ id: 'e1', description: 'x'.repeat(MAX_TEXTO_CORTO + 1) })).toBeNull();
    expect(excesoDe({ id: 'g1', name: 'x'.repeat(MAX_TEXTO_CORTO + 1) })).toBeNull();
    expect(excesoDe({ id: 'e1', note: 'x'.repeat(MAX_NOTA + 1) })).toBeNull();
  });

  it('demasiados miembros sigue siendo exceso, para un registro vivo', () => {
    expect(excesoDe({
      id: 'g1', isDeleted: false,
      memberIds: Array.from({ length: MAX_MIEMBROS + 1 }, (_, i) => `u${i}`),
    })).toBe('memberIds');
  });

  /**
   * R8 (T-182): `miembros` es el roster real — historial de altas/bajas por
   * clave, no la lista viva — y por eso su tope es el DOBLE de
   * `MAX_MIEMBROS`: un grupo activo con mucha rotación (gente que entra y
   * sale) acumula más entradas en `miembros` que en `memberIds` sin que eso
   * sea, por sí solo, un ataque.
   */
  it('roster (`miembros`) por encima de 2×MAX_MIEMBROS es exceso, para un registro vivo', () => {
    const miembros = Object.fromEntries(
      Array.from({ length: 2 * MAX_MIEMBROS + 1 }, (_, i) => [`u${i}`, { estado: 'in', at: i }]),
    );
    expect(excesoDe({ id: 'g1', isDeleted: false, miembros })).toBe('miembros');
  });

  it('un roster de exactamente 2×MAX_MIEMBROS todavía entra', () => {
    const miembros = Object.fromEntries(
      Array.from({ length: 2 * MAX_MIEMBROS }, (_, i) => [`u${i}`, { estado: 'in', at: i }]),
    );
    expect(excesoDe({ id: 'g1', isDeleted: false, miembros })).toBeNull();
  });

  it('un tombstone con `miembros` gigante queda exento, igual que con `memberIds`', () => {
    const miembros = Object.fromEntries(
      Array.from({ length: 2 * MAX_MIEMBROS + 1 }, (_, i) => [`u${i}`, { estado: 'out', at: i }]),
    );
    expect(excesoDe({ id: 'g1', isDeleted: true, miembros })).toBeNull();
  });

  it('un registro que pesa más que el tope duro, aunque cada campo sea razonable', () => {
    const splits = Array.from({ length: 6_000 }, (_, i) => ({ userId: `usuario-${i}`, amount: 1, isPaid: false }));
    expect(excesoDe({ id: 'e1', description: 'Cena', splits })).toBe('bytes');
  });

  it('campos ausentes o de otro tipo no cuentan como exceso', () => {
    expect(excesoDe({ id: 'e1', description: 123, memberIds: 'no-es-array' })).toBeNull();
  });

  // T-206-A (D3): acá había un test que comparaba `MAX_REGISTRO_BYTES` contra
  // `MAX_SLICE_BYTES` (`ckey.ts`) — dos nombres para el mismo valor, que
  // podían separarse por error hasta D8 (Task 2), cuando los dos pasaron a
  // importar la MISMA constante de `limites.ts`. D3 borró el alias por no
  // tener consumidores reales; con un solo nombre no queda nada que comparar.

  // D2 (verifier): un tombstone nunca se excluye por contenido — ni texto (ya
  // cubierto arriba, es global) ni memberIds heredados de antes del borrado.
  describe('tombstones (isDeleted: true) — nunca por contenido (D2)', () => {
    it('memberIds heredado > MAX_MIEMBROS no cuenta como exceso si isDeleted', () => {
      const tombstoneGrupo = {
        id: 'g1', isDeleted: true,
        memberIds: Array.from({ length: MAX_MIEMBROS + 50 }, (_, i) => `u${i}`),
      };
      expect(excesoDe(tombstoneGrupo)).toBeNull();
    });

    it('el mismo registro, vivo (isDeleted: false), sí excede por memberIds', () => {
      const vivo = {
        id: 'g1', isDeleted: false,
        memberIds: Array.from({ length: MAX_MIEMBROS + 50 }, (_, i) => `u${i}`),
      };
      expect(excesoDe(vivo)).toBe('memberIds');
    });

    it('un tombstone que además pesa más que el tope duro sigue excediendo por bytes (residual documentado, no memberIds)', () => {
      const splits = Array.from({ length: 6_000 }, (_, i) => ({ userId: `usuario-${i}`, amount: 1, isPaid: false }));
      expect(excesoDe({ id: 'e1', isDeleted: true, splits })).toBe('bytes');
    });
  });
});

describe('truncar — topes de caracteres en textos que genera la app (T-150 ronda 2, D3)', () => {
  it('no toca un texto que ya entra en el tope', () => {
    expect(truncar('Viaje', MAX_TEXTO_CORTO)).toBe('Viaje');
  });
  it('corta al tope exacto un texto más largo', () => {
    const largo = 'x'.repeat(MAX_TEXTO_CORTO + 50);
    const resultado = truncar(largo, MAX_TEXTO_CORTO);
    expect(resultado).toHaveLength(MAX_TEXTO_CORTO);
    expect(resultado).toBe('x'.repeat(MAX_TEXTO_CORTO));
  });

  /**
   * T-172 (ítem 5, deuda de T-150 ronda 3): `truncar` cortaba por unidad
   * UTF-16 (`String#slice`). Un emoji fuera del BMP (😀) son DOS unidades — un
   * surrogate alto + uno bajo — y si el corte cae justo en el medio, el
   * resultado queda con un surrogate alto SUELTO al final: no es texto UTF-16
   * válido (se ve como un glifo de reemplazo en cualquier UI, y algunos
   * serializadores lo rechazan).
   */
  it('no parte un par surrogate (emoji) por la mitad', () => {
    const base = 'x'.repeat(4);
    const conEmoji = `${base}\u{1F600}`; // 4 + 2 unidades UTF-16 = largo 6
    const resultado = truncar(conEmoji, 5); // el corte cae justo en el surrogate alto

    // Nunca puede quedar un surrogate alto (0xD800–0xDBFF) sin su par bajo al final.
    const ultimo = resultado.charCodeAt(resultado.length - 1);
    expect(ultimo >= 0xD800 && ultimo <= 0xDBFF).toBe(false);
    expect(resultado).toBe(base); // se descarta el emoji entero, no queda basura
  });

  it('con lugar de sobra para el emoji entero, lo conserva intacto', () => {
    const conEmoji = 'x'.repeat(4) + '\u{1F600}';
    expect(truncar(conEmoji, 10)).toBe(conEmoji);
  });
});

describe('admiteUnMiembroMas — tope de miembros al AGREGAR (T-150 ronda 2, D4)', () => {
  it('admite si hay lugar', () => {
    expect(admiteUnMiembroMas(Array.from({ length: MAX_MIEMBROS - 1 }, (_, i) => `u${i}`))).toBe(true);
  });
  it('rechaza si el grupo ya está en el tope', () => {
    expect(admiteUnMiembroMas(Array.from({ length: MAX_MIEMBROS }, (_, i) => `u${i}`))).toBe(false);
  });
});

describe('guard: los inputs de texto libre tienen maxLength', () => {
  it.each([
    // T-223: los inputs de Nuevo gasto se mudaron a sus componentes.
    [
      'src/screens/expense/components/DescripcionYCategorias.tsx',
      /onChangeText=\{onChangeText\}[\s\S]{0,400}?maxLength=\{MAX_TEXTO_CORTO\}/,
    ],
    ['src/screens/expense/components/HojasDeGasto.tsx', /onChangeText=\{onNoteChange\}[\s\S]{0,400}?maxLength=\{MAX_NOTA\}/],
    ['app/groups/new.tsx',  /onChangeText=\{setName\}[\s\S]{0,400}?maxLength=\{MAX_TEXTO_CORTO\}/],
    // T-209: el input "sin app" se mudó de `app/groups/[id].tsx` al
    // componente que ahora lo dueña — mismo guard, nueva casa.
    [
      'src/screens/groups/components/InvitarPorUsernameSheet.tsx',
      /value=\{inviteName\}[\s\S]{0,400}?maxLength=\{MAX_TEXTO_CORTO\}/,
    ],
  ])('%s', (archivo, patron) => {
    // T-206-A: este test se mudó un nivel más adentro (nucleo/__tests__).
    const texto = readFileSync(resolve(__dirname, '../../../..', archivo), 'utf8');
    expect(texto).toMatch(patron);
  });
});
