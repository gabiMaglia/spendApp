#!/usr/bin/env bash
# Publica el sitio público de la app en https://spendapp.github.io/.
#
# La fuente de verdad es docs/web/ de ESTE repo (la testean src/__tests__/paginaAbrir y
# src/constants/__tests__/legal). Este script copia al repo de la organización:
#   - docs/web/abrir.html            → index.html   (abre la app desde un link; índice del sitio)
#   - docs/web/<página>.<idioma>.html → igual        (privacidad, términos, borrado de cuenta)
# docs/web/index.html NO se copia: en el sitio de la organización el índice es abrir.html.
#
# Borra del sitio lo que ya no esté en docs/web, para que no quede una página legal vieja
# publicada que diga algo distinto de la actual.
#
# T-134 (SEC3 S3-B1): publica docs/web del COMMIT (HEAD), nunca del árbol de trabajo. Antes
# copiaba los archivos tal cual estaban en disco, y así podía salir un abrir.html editado a
# mano que no había pasado sus tests. Si docs/web tiene cambios sin commitear, se niega.
# También copia docs/web/.well-known/ (el AASA de Universal Links que va a necesitar T-097).
#
# Uso: scripts/publicar-sitio.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DESTINO="https://github.com/spendapp/spendapp.github.io.git"

if [ -n "$(git -C "$RAIZ" status --porcelain -- docs/web)" ]; then
  echo "docs/web tiene cambios sin commitear: commitealos (y que pasen los tests) antes de publicar" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# La fuente es el commit, no el disco.
mkdir -p "$TMP/fuente"
git -C "$RAIZ" archive HEAD docs/web | tar -x -C "$TMP/fuente"
WEB="$TMP/fuente/docs/web"

[ -f "$WEB/abrir.html" ] || { echo "no existe docs/web/abrir.html en HEAD" >&2; exit 1; }

git clone --quiet "$DESTINO" "$TMP/sitio"
cd "$TMP/sitio"
git checkout --quiet -B main

# El sitio se reconstruye entero desde docs/web: nada viejo sobrevive por descuido.
git rm --quiet -r --cached . >/dev/null 2>&1 || true
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

cp "$WEB/abrir.html" index.html
for f in "$WEB"/*.html; do
  nombre="$(basename "$f")"
  case "$nombre" in
    index.html|abrir.html) ;;
    *) cp "$f" "$nombre" ;;
  esac
done
# Universal Links (T-097): el AASA vive en .well-known/ y va sin extensión.
if [ -d "$WEB/.well-known" ]; then
  cp -R "$WEB/.well-known" .well-known
fi
# Sin Jekyll: son HTML estáticos y no hay nada que procesar (y Jekyll ignora los .dirs).
touch .nojekyll

git add -A
if git diff --cached --quiet; then
  echo "sin cambios: el sitio publicado ya es el de docs/web"
  exit 0
fi

ORIGEN="$(git -C "$RAIZ" rev-parse --short HEAD)"
git commit --quiet -m "publica docs/web desde spendApp@${ORIGEN}"
git push --quiet origin main
echo "publicado: https://spendapp.github.io/ (desde spendApp@${ORIGEN})"
git ls-files | sed 's/^/  /'
