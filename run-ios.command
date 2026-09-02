#!/bin/zsh
# TERMINAL 2 — iOS.
#
# LEER ESTO ANTES DE PELEARLE AL SCRIPT:
# el build local de iOS NO COMPILA en esta Mac. Xcode 15.2 contra Expo SDK 54 /
# reanimated 4, que piden 16.1+. El iPhone FISICO no esta afectado porque lo
# buildea EAS en la nube. Por eso el camino por defecto de aca es EAS, no
# `expo run:ios`. No reintentar el build local sin actualizar Xcode.

set -uo pipefail
source "${0:A:h}/dev-env.sh"
cd "$PROJECT_DIR" || exit 1

titulo "iOS"

XCODE_VER=$(xcodebuild -version 2>/dev/null | head -1 | awk '{print $2}')
XCODE_MAJOR=${XCODE_VER%%.*}
XCODE_MINOR=$(echo "$XCODE_VER" | cut -d. -f2)
[[ -z "$XCODE_MINOR" ]] && XCODE_MINOR=0

XCODE_OK=0
if [[ -n "$XCODE_MAJOR" ]]; then
  if (( XCODE_MAJOR > 16 )) || { (( XCODE_MAJOR == 16 )) && (( XCODE_MINOR >= 1 )); }; then
    XCODE_OK=1
  fi
fi

echo "Xcode detectado : ${XCODE_VER:-ninguno}   (el build local pide 16.1+)"
URL="$(metro_url)"
echo "Metro           : ${URL:-sin IP de LAN}   $(metro_running && echo '(corriendo)' || echo '(APAGADO)')"
echo

if ! metro_running; then
  echo "⚠️  Metro no esta corriendo. Arranca start-dev.command primero:"
  echo "    el dev client del iPhone no tiene a que conectarse."
  echo
fi

echo "El dev client YA esta instalado en el iPhone del PO (sesiones 21-22/08)."
echo "Si no cambio nada nativo, no hay NADA que compilar."
echo
echo "  1) Conectar el iPhone que ya tiene la app  ← lo normal"
echo "  2) Buildear un dev client nuevo con EAS    (solo si cambio algo nativo)"
if (( XCODE_OK )); then
  echo "  3) Build local con Xcode                   (tu Xcode ya lo soporta)"
else
  echo "  3) Build local con Xcode                   — BLOQUEADO por Xcode ${XCODE_VER}"
fi
echo
printf "¿Que hago? [1] "
read -r op
[[ -z "$op" ]] && op=1

case "$op" in
  1)
    echo
    echo "En el iPhone:"
    echo "  1. Abri la app 'spendApp' (el dev client)."
    echo "  2. Deberia listar el Metro de esta Mac en la LAN → tocalo."
    echo "  3. Si no lo ve: 'Enter URL manually' y meté:"
    echo
    echo "       ${URL:-http://<ip-de-la-mac>:${METRO_PORT}}"
    echo
    echo "  4. Si sigue sin conectar, el iPhone esta en otra red: cerra Metro"
    echo "     y relanzalo con  npx expo start --dev-client --tunnel"
    ;;
  2)
    echo
    echo "Build en la nube (evita tu Xcode). Tarda y consume cuota de EAS."
    printf "¿Confirmas? [s/N] "
    read -r c
    if [[ "$c" == "s" || "$c" == "S" ]]; then
      echo
      eas build --profile development --platform ios
      echo
      echo "Cuando termine: instala el build en el iPhone desde el QR/link,"
      echo "abri la app y volve a la opcion 1 para conectarla a Metro."
    else
      echo "Cancelado."
    fi
    ;;
  3)
    if (( XCODE_OK )); then
      echo
      npx expo run:ios --no-bundler --device
    else
      echo
      echo "❌ Bloqueado a proposito. Xcode ${XCODE_VER} no compila Expo SDK 54"
      echo "   ni reanimated 4 (piden 16.1+). Esto ya se intento y se documento;"
      echo "   el build va a fallar despues de varios minutos."
      echo "   Camino real: opcion 2 (EAS) o actualizar Xcode."
    fi
    ;;
  *)
    echo "Opcion invalida."
    ;;
esac

pausa_al_salir
