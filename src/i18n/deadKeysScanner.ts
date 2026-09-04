import * as ts from 'typescript';

/**
 * Guard de claves i18n muertas (T-070).
 *
 * El punto de partida fue una regex de comillas balanceadas escaneando el
 * código fuente. Se probó en carne propia por qué eso no sirve: un solo
 * apóstrofo suelto en un comentario en inglés (`// who's paying...` en
 * app/settle/new.tsx) desincroniza la cuenta de comillas para TODO el resto
 * del archivo, y de ahí en más cualquier string real deja de matchear —
 * `settle.settle_all`, que se usa, apareció como huérfana. Por eso todo acá
 * usa el compilador de TypeScript para parsear de verdad: un comentario no es
 * un string literal para el AST, pase lo que pase adentro.
 */

/**
 * Prefijos de clave legítimamente dinámicos: se arman con template literal en
 * runtime y por lo tanto NUNCA van a aparecer como string literal completo en
 * el código. Único caso real del proyecto: `t(\`categories.${cat.id}\`)` en
 * app/expense/new.tsx. Si aparece un segundo caso, se agrega acá a mano — no
 * hay forma de inferirlo del AST sin falsos negativos.
 */
export const DYNAMIC_KEY_PREFIXES = ['categories.'] as const;

const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'] as const;

/**
 * Si `key` es la forma plural de i18next de otra clave (p.ej.
 * `notifications.new_expenses_other` de `notifications.new_expenses`),
 * devuelve la base. Si no, null.
 *
 * Hace falta porque i18next resuelve `t('notifications.new_expenses', {count})`
 * contra `new_expenses_one`/`new_expenses_other` — la clave base nunca existe
 * como tal en el JSON cuando ambas variantes están definidas, y el código
 * nunca llama a la variante sufijada directamente en ese caso.
 */
export function pluralBaseOf(key: string): string | null {
  for (const suf of PLURAL_SUFFIXES) {
    if (key.endsWith(suf)) return key.slice(0, -suf.length);
  }
  return null;
}

type Nodo = { [k: string]: unknown };

/** Aplana un diccionario anidado (es/en/pt.json) a rutas con punto. */
export function flattenKeys(obj: Nodo, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const ruta = prefix ? `${prefix}.${k}` : k;
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? flattenKeys(v as Nodo, ruta)
      : [ruta];
  });
}

function parse(source: string, isTsx: boolean): ts.SourceFile {
  return ts.createSourceFile(
    isTsx ? 'archivo.tsx' : 'archivo.ts',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * Todos los string literal / template literal SIN interpolación de un
 * archivo fuente (cualquiera, no sólo los que están dentro de un `t(...)`).
 *
 * Deliberadamente amplio: una clave puede llegar a `t()` indirecto vía una
 * tabla (`{ key: 'sync.synced' }` en SyncStatusBadge.tsx, `labelKey:
 * 'personal.kind_expense'` en personal.tsx) y ahí el literal vive en la
 * definición de la tabla, no en el call site. Sirve para el chequeo de
 * huérfanas: "¿esta clave aparece en ALGÚN lado del código, como sea?".
 */
export function extractStringLiterals(source: string, isTsx: boolean): string[] {
  const sourceFile = parse(source, isTsx);
  const literales: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literales.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literales;
}

/**
 * Alias de `t` que este ARCHIVO liga a `useTranslation()` (T-072/D1).
 *
 * QA encontró que `esLlamadaAT` sólo reconocía el identificador literal `t`: renombrar al
 * desestructurar (`const { t: tr } = useTranslation()`) — patrón que el proyecto ya usa en
 * otros hooks, ver `app/(tabs)/personal.tsx:106` — apagaba el guard entero con un cambio de
 * una palabra. Se resuelve por archivo (un `Set` nuevo por cada `parse`), nunca global: un
 * alias de un archivo no debe filtrar a otro.
 *
 * Formas cubiertas, ambas atadas a una llamada real a `useTranslation(...)`:
 *   - `const { t: tr } = useTranslation()` (o sin alias, `{ t }`, que ya cae en el Set).
 *   - `const tt = useTranslation().t`.
 * `hook.t(...)` (el hook guardado entero y usado como propiedad) no necesita alias: la rama
 * `PropertyAccessExpression` de abajo ya acepta cualquier objeto con miembro `.t`.
 */
function collectTAliases(sourceFile: ts.SourceFile): Set<string> {
  const aliases = new Set<string>(['t']);
  const hookVars = new Set<string>();

  const esLlamadaAUseTranslation = (expr: ts.Expression): boolean =>
    ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'useTranslation';

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = node.initializer;

      if (ts.isObjectBindingPattern(node.name) && esLlamadaAUseTranslation(init)) {
        for (const el of node.name.elements) {
          if (ts.isIdentifier(el.propertyName ?? el.name) === false) continue;
          const nombreOrigen = (el.propertyName ?? el.name) as ts.Identifier;
          if (nombreOrigen.text === 't' && ts.isIdentifier(el.name)) aliases.add(el.name.text);
        }
      }

      if (ts.isIdentifier(node.name)) {
        if (esLlamadaAUseTranslation(init)) {
          hookVars.add(node.name.text);
        } else if (
          ts.isPropertyAccessExpression(init) &&
          init.name.text === 't' &&
          (esLlamadaAUseTranslation(init.expression) ||
            (ts.isIdentifier(init.expression) && hookVars.has(init.expression.text)))
        ) {
          aliases.add(node.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return aliases;
}

function esLlamadaAT(expr: ts.Expression, aliases: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(expr)) return aliases.has(expr.text);
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text === 't';
  return false;
}

/**
 * Los literales que son el primer argumento de una llamada DIRECTA a
 * `t(...)` o `i18n.t(...)` — no una clave indirecta vía variable
 * (`t(meta.labelKey)`, `t(opt.key)` quedan afuera a propósito).
 *
 * Es el que alimenta "clave viva borrada": si el código llama
 * `t('foo.bar')` literal y `foo.bar` no existe en es.json, es una clave que
 * se usa y se perdió — no cualquier string con forma de clave (un ícono, un
 * nombre de archivo) que nunca pasó por `t()`.
 */
export function extractDirectTCallArgs(source: string, isTsx: boolean): string[] {
  const sourceFile = parse(source, isTsx);
  const aliases = collectTAliases(sourceFile);
  const literales: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && esLlamadaAT(node.expression, aliases)) {
      const primero = node.arguments[0];
      if (primero && (ts.isStringLiteral(primero) || ts.isNoSubstitutionTemplateLiteral(primero))) {
        literales.push(primero.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literales;
}

/**
 * Claves llamadas con `defaultValue` — la muleta que esconde una clave faltante.
 *
 * `t('x.y', { defaultValue: 'Texto' })` devuelve ese texto cuando `x.y` no existe, así que la
 * pantalla se ve bien y nadie se entera de que falta la traducción. Peor: el default se escribe
 * en UN idioma, así que en los otros dos se muestra ese mismo texto. Pasó de verdad — seis claves
 * del proyecto tenían default en español y en inglés y portugués se veía castellano (T-070).
 *
 * Y es invisible para la suite: el CLAUDE.md manda mockear i18next a «devolvé la clave», con lo
 * cual ningún test ejecuta jamás la resolución real.
 *
 * Devuelve la clave de cada llamada así, para que el guard pueda nombrarla.
 */
/** `p.name` es `defaultValue`, ya sea como `Identifier` o como `StringLiteral` (T-072/D2: `{ "defaultValue": … }`). */
function esNombreDefaultValue(name: ts.PropertyName): boolean {
  return (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === 'defaultValue';
}

/**
 * El segundo argumento es un objeto literal que se puede leer ENTERO — sin spread ni clave
 * computada (T-072/D3/D4). Cuando esto da `false` (objeto con spread/clave computada, una
 * llamada como `Object.assign(...)`, o cualquier otra expresión que no sea un literal), el
 * llamador lo trata como sospechoso en vez de mirar para el costado: no hay análisis estático
 * que gane siempre contra esas formas — el valor real de esas propiedades sólo se conoce en
 * runtime. Se invierte la carga de la prueba: si no se puede leer entero, el guard obliga a
 * reescribirlo en forma explícita en vez de desaparecer en silencio (falso negativo, que es
 * justo el bug que este guard existe para cerrar).
 */
function esObjetoLiteralLegible(segundo: ts.Expression): segundo is ts.ObjectLiteralExpression {
  return (
    ts.isObjectLiteralExpression(segundo) &&
    segundo.properties.every(
      p => !ts.isSpreadAssignment(p) && !(p.name !== undefined && ts.isComputedPropertyName(p.name)),
    )
  );
}

export function findDefaultValueKeys(source: string, isTsx: boolean): string[] {
  const sourceFile = parse(source, isTsx);
  const aliases = collectTAliases(sourceFile);
  const encontradas: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && esLlamadaAT(node.expression, aliases)) {
      const [primero, segundo] = node.arguments;
      if (segundo !== undefined) {
        const clave =
          primero && (ts.isStringLiteral(primero) || ts.isNoSubstitutionTemplateLiteral(primero))
            ? primero.text
            : '<clave dinámica>';
        if (!esObjetoLiteralLegible(segundo)) {
          encontradas.push(`<no analizable: ${clave}>`);
        } else if (segundo.properties.some(p => p.name !== undefined && esNombreDefaultValue(p.name))) {
          encontradas.push(clave);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return encontradas;
}

/** Forma real de una clave i18n del proyecto: segmentos snake_case separados por punto. */
const FORMA_DE_CLAVE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

export function pareceClaveI18n(literal: string): boolean {
  return FORMA_DE_CLAVE.test(literal);
}

/**
 * Claves de `allKeys` que no aparecen como literal en `usedLiterals` (ni su
 * base plural, si corresponde), ni matchean un prefijo dinámico declarado.
 *
 * Escenario "no sobrevive ninguna clave huérfana" / "el guard atrapa una
 * clave muerta nueva".
 */
export function findOrphanKeys(
  allKeys: readonly string[],
  usedLiterals: ReadonlySet<string>,
  dynamicPrefixes: readonly string[] = DYNAMIC_KEY_PREFIXES,
): string[] {
  return allKeys.filter(key => {
    if (dynamicPrefixes.some(p => key.startsWith(p))) return false;
    if (usedLiterals.has(key)) return false;
    const base = pluralBaseOf(key);
    if (base && usedLiterals.has(base)) return false;
    return true;
  });
}

/**
 * Claves que el código llama directamente vía `t(...)`/`i18n.t(...)` (forma
 * de clave i18n real, sin prefijo dinámico) pero no existen en `allKeys` —
 * una clave viva que se borró.
 *
 * Escenario "el guard atrapa una clave viva borrada".
 */
export function findMissingKeys(
  calledLiterals: readonly string[],
  allKeys: readonly string[],
  dynamicPrefixes: readonly string[] = DYNAMIC_KEY_PREFIXES,
): string[] {
  const keySet = new Set(allKeys);
  const faltantes = new Set<string>();
  for (const lit of calledLiterals) {
    if (!pareceClaveI18n(lit)) continue;
    if (dynamicPrefixes.some(p => lit.startsWith(p))) continue;
    if (keySet.has(lit)) continue;
    if (PLURAL_SUFFIXES.some(suf => keySet.has(`${lit}${suf}`))) continue;
    faltantes.add(lit);
  }
  return [...faltantes].sort();
}
