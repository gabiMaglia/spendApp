#!/usr/bin/env bash
set -euo pipefail

SRC="${1:-assets/reskin/impl}"
BRANCH=reskin/flat-bands

[ -f package.json ] || { echo "✗ Corré esto desde la raíz del repo."; exit 1; }
[ -d "$SRC/app" ] && [ -d "$SRC/src" ] || { echo "✗ No encuentro $SRC/app y $SRC/src"; exit 1; }

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✗ Tenés cambios sin commitear. Guardalos primero."; exit 1
fi

git rev-parse --verify "$BRANCH" >/dev/null 2>&1 \
  && git checkout "$BRANCH" \
  || git checkout -b "$BRANCH"

echo "→ copiando desde $SRC"
cp -a "$SRC/src/." src/
cp -a "$SRC/app/." app/

rm -rf assets/reskin

git status --short
git add -A
git commit -m "reskin: flat bands (tokens, bandas, header colapsable, 6 tabs)" \
  || echo "→ nada que commitear"

echo "✓ Listo. Estás en $BRANCH — npx expo start"
