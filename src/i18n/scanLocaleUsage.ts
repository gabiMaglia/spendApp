import fs from 'fs';
import path from 'path';

import { extractDirectTCallArgs, extractStringLiterals, findDefaultValueKeys } from './deadKeysScanner';

/** Directorios que el ticket manda escanear (T-070). */
const ROOT_DIRS = ['app', 'src', 'components', 'hooks', 'constants'];

/** Nombres de directorio que se saltean enteros al caminar el árbol. */
const SKIP_DIR_NAMES = new Set(['node_modules', '__tests__']);

function isSourceFile(name: string): boolean {
  return name.endsWith('.ts') || name.endsWith('.tsx');
}

function walk(dir: string, acc: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (isSourceFile(entry.name)) acc.push(full);
  }
}

function listSourceFiles(repoRoot: string): string[] {
  const acc: string[] = [];
  for (const dir of ROOT_DIRS) {
    const full = path.join(repoRoot, dir);
    if (fs.existsSync(full)) walk(full, acc);
  }
  return acc;
}

export type UsoDeLocales = {
  /** Todo literal de string/template estático encontrado en el código, sea cual sea su rol. */
  usedLiterals: Set<string>;
  /** Sólo los que son primer argumento de una llamada directa a t()/i18n.t(). */
  calledLiterals: string[];
  /** Claves llamadas con `defaultValue`: la muleta que esconde una traducción faltante. */
  conDefaultValue: string[];
};

/**
 * Escanea `app/`, `src/`, `components/`, `hooks/` (excluyendo `__tests__`) y
 * devuelve los literales relevantes para el guard de claves muertas. No lee
 * los JSON de locales — eso lo hace quien llama, comparando contra el
 * resultado.
 */
export function scanRepoUsage(repoRoot: string): UsoDeLocales {
  const files = listSourceFiles(repoRoot);
  const usedLiterals = new Set<string>();
  const calledLiterals: string[] = [];
  const conDefaultValue: string[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const isTsx = file.endsWith('.tsx');
    for (const lit of extractStringLiterals(src, isTsx)) usedLiterals.add(lit);
    calledLiterals.push(...extractDirectTCallArgs(src, isTsx));
    conDefaultValue.push(...findDefaultValueKeys(src, isTsx));
  }
  return { usedLiterals, calledLiterals, conDefaultValue };
}
