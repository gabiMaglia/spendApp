#!/usr/bin/env bash
# Publica la página que abre la app desde un link en https://spendapp.github.io/.
#
# La fuente de verdad es docs/web/abrir.html de ESTE repo (la testea src/__tests__/paginaAbrir
# y src/constants/__tests__/legal). Este script la copia como index.html del repo de la
# organización y la pushea; GitHub Pages la sirve en un minuto. La copia de docs/web se sigue
# publicando sola en el GitHub personal, para los links viejos.
#
# Uso: scripts/publicar-pagina-links.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
FUENTE="$RAIZ/docs/web/abrir.html"
DESTINO="https://github.com/spendapp/spendapp.github.io.git"

[ -f "$FUENTE" ] || { echo "no existe $FUENTE" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet "$DESTINO" "$TMP/sitio"
cd "$TMP/sitio"
git checkout --quiet -B main

cp "$FUENTE" index.html
# Sin Jekyll: el sitio es un solo HTML estático y no hay nada que procesar.
touch .nojekyll

git add index.html .nojekyll
if git diff --cached --quiet; then
  echo "sin cambios: la página publicada ya es la de docs/web/abrir.html"
  exit 0
fi

ORIGEN="$(git -C "$RAIZ" rev-parse --short HEAD)"
git commit --quiet -m "publica abrir.html desde spendApp@${ORIGEN}"
git push --quiet origin main
echo "publicado: https://spendapp.github.io/ (desde spendApp@${ORIGEN})"
