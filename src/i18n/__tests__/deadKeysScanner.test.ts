import {
  DYNAMIC_KEY_PREFIXES,
  extractDirectTCallArgs,
  extractStringLiterals,
  findMissingKeys,
  findOrphanKeys,
  flattenKeys,
  pareceClaveI18n,
  pluralBaseOf,
} from '../deadKeysScanner';

describe('flattenKeys', () => {
  it('aplana un diccionario anidado a rutas con punto', () => {
    expect(flattenKeys({ a: { b: '1', c: { d: '2' } }, e: '3' }).sort()).toEqual(
      ['a.b', 'a.c.d', 'e'].sort(),
    );
  });

  it('devuelve vacío para un diccionario vacío', () => {
    expect(flattenKeys({})).toEqual([]);
  });
});

describe('extractStringLiterals', () => {
  it('extrae literales de comillas simples, dobles y template sin interpolación', () => {
    const src = `const a = 'foo.bar'; const b = "baz.qux"; const c = \`plain.key\`;`;
    expect(extractStringLiterals(src, false)).toEqual(
      expect.arrayContaining(['foo.bar', 'baz.qux', 'plain.key']),
    );
  });

  it('no se desincroniza con un apóstrofo suelto en un comentario en inglés', () => {
    // Bug real encontrado escaneando app/settle/new.tsx con una regex de
    // comillas: el comentario "// who's paying and how much" comía la
    // cuenta de comillas para el resto del archivo, y 'settle.settle_all'
    // — que SÍ se usa — aparecía como huérfana. El AST no tiene ese problema:
    // un comentario nunca es un nodo de string literal.
    const src = `
      // who's paying and how much
      const key = 'settle.settle_all';
    `;
    expect(extractStringLiterals(src, false)).toContain('settle.settle_all');
  });

  it('no se desincroniza con un apóstrofo suelto en un comentario en español', () => {
    const src = `
      // el usuario elegí­ó no participar — apóstrofo random d'acá
      const key = 'settle.settle_one';
    `;
    expect(extractStringLiterals(src, false)).toContain('settle.settle_one');
  });

  it('ignora el contenido interpolado de un template literal dinámico', () => {
    const src = "t(`categories.${cat.id}`)";
    expect(extractStringLiterals(src, false)).not.toContain('categories.${cat.id}');
  });

  it('extrae literales dentro de JSX (.tsx)', () => {
    const src = `function C() { return <Text>{t('common.done')}</Text>; }`;
    expect(extractStringLiterals(src, true)).toContain('common.done');
  });
});

describe('extractDirectTCallArgs', () => {
  it('captura el primer argumento de t(...) literal', () => {
    expect(extractDirectTCallArgs("t('expense.save')", false)).toEqual(['expense.save']);
  });

  it('captura i18n.t(...) igual que t(...)', () => {
    expect(extractDirectTCallArgs("i18n.t('common.today')", false)).toEqual(['common.today']);
  });

  it('ignora una llamada a t() con una clave indirecta vía variable', () => {
    // t(meta.labelKey), t(opt.key): la clave real vive en la definición de
    // la tabla, no en el call site — extractStringLiterals la agarra ahí.
    expect(extractDirectTCallArgs('t(meta.labelKey)', false)).toEqual([]);
  });

  it('ignora funciones que no son t()/i18n.t() aunque terminen en "t("', () => {
    expect(extractDirectTCallArgs("format('foo.bar')", false)).toEqual([]);
  });

  it('no revienta con una llamada a t() con template dinámico', () => {
    expect(extractDirectTCallArgs('t(`categories.${cat.id}`)', false)).toEqual([]);
  });
});

describe('pareceClaveI18n', () => {
  it('acepta la forma real de una clave del proyecto', () => {
    expect(pareceClaveI18n('expense.no_group_short')).toBe(true);
    expect(pareceClaveI18n('dashboard.groups_count_one')).toBe(true);
  });

  it('rechaza un string sin punto (no puede ser una ruta de clave)', () => {
    expect(pareceClaveI18n('sinpunto')).toBe(false);
  });

  it('rechaza texto con mayúsculas o espacios', () => {
    expect(pareceClaveI18n('Hola Mundo')).toBe(false);
    expect(pareceClaveI18n('Auth.Continue')).toBe(false);
  });
});

describe('findMissingKeys ignora literales con forma de clave que nunca pasaron por t()', () => {
  it('un nombre de ícono (SF Symbol) con puntos no genera un falso "faltante"', () => {
    // 'chevron.right' matchea la FORMA de una clave, pero extractDirectTCallArgs
    // nunca lo agrega a calledLiterals porque no es argumento de t()/i18n.t() —
    // es un prop `name="chevron.right"` de <Ionicons>. findMissingKeys sólo ve
    // lo que le pasan; el filtro real pasa por extractDirectTCallArgs, no acá.
    const src = '<Ionicons name="chevron.right" />';
    expect(extractDirectTCallArgs(src, true)).toEqual([]);
  });
});

describe('pluralBaseOf', () => {
  it('devuelve la base de una clave con sufijo plural de i18next', () => {
    expect(pluralBaseOf('notifications.new_expenses_other')).toBe('notifications.new_expenses');
    expect(pluralBaseOf('notifications.new_expenses_one')).toBe('notifications.new_expenses');
  });

  it('devuelve null si la clave no tiene sufijo plural', () => {
    expect(pluralBaseOf('common.done')).toBeNull();
  });
});

describe('findOrphanKeys — el guard atrapa una clave muerta nueva', () => {
  it('nombra una clave que nadie usa', () => {
    const allKeys = ['common.save', 'common.cancel', 'common.unused_ghost'];
    const usados = new Set(['common.save', 'common.cancel']);
    expect(findOrphanKeys(allKeys, usados)).toEqual(['common.unused_ghost']);
  });

  it('no marca huérfana una clave viva', () => {
    const allKeys = ['common.save'];
    expect(findOrphanKeys(allKeys, new Set(['common.save']))).toEqual([]);
  });

  it('no marca huérfanas las claves dinámicas declaradas (categories.*)', () => {
    const allKeys = ['categories.food', 'categories.transport'];
    expect(findOrphanKeys(allKeys, new Set())).toEqual([]);
  });

  it('respeta la lista de prefijos dinámicos pasada explícitamente', () => {
    const allKeys = ['icons.custom_one'];
    expect(findOrphanKeys(allKeys, new Set(), ['icons.'])).toEqual([]);
    expect(findOrphanKeys(allKeys, new Set(), DYNAMIC_KEY_PREFIXES)).toEqual(['icons.custom_one']);
  });

  it('no marca huérfana la forma plural de una clave usada en singular', () => {
    const allKeys = ['notifications.new_expenses_one', 'notifications.new_expenses_other'];
    // así aparece el literal real en el código: t('notifications.new_expenses', {count})
    const usados = new Set(['notifications.new_expenses']);
    expect(findOrphanKeys(allKeys, usados)).toEqual([]);
  });

  it('SÍ marca huérfana una clave con forma de plural si ni ella ni su base se usan', () => {
    const allKeys = ['settle.settle_other'];
    expect(findOrphanKeys(allKeys, new Set())).toEqual(['settle.settle_other']);
  });
});

describe('findMissingKeys — el guard atrapa una clave viva borrada', () => {
  it('nombra una clave que el código llama pero no existe en es.json', () => {
    const llamadas = ['expense.save', 'expense.borrada_por_error'];
    const allKeys = ['expense.save'];
    expect(findMissingKeys(llamadas, allKeys)).toEqual(['expense.borrada_por_error']);
  });

  it('no reporta nada si todas las claves llamadas existen', () => {
    const llamadas = ['expense.save'];
    const allKeys = ['expense.save'];
    expect(findMissingKeys(llamadas, allKeys)).toEqual([]);
  });

  it('no reporta una clave pluralizada resuelta por sus variantes _one/_other', () => {
    const llamadas = ['notifications.new_expenses'];
    const allKeys = ['notifications.new_expenses_one', 'notifications.new_expenses_other'];
    expect(findMissingKeys(llamadas, allKeys)).toEqual([]);
  });

  it('ignora un literal sin forma de clave (sin punto)', () => {
    expect(findMissingKeys(['sinpunto'], [])).toEqual([]);
  });

  it('ignora un prefijo dinámico aunque no exista ninguna clave concreta', () => {
    const llamadas = ['categories.'];
    expect(findMissingKeys(llamadas, [], ['categories.'])).toEqual([]);
  });

  it('no duplica la misma clave faltante llamada más de una vez', () => {
    const llamadas = ['expense.borrada', 'expense.borrada'];
    expect(findMissingKeys(llamadas, [])).toEqual(['expense.borrada']);
  });
});
