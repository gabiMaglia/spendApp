#!/bin/zsh
# Entorno compartido de los scripts de dev de SplitP2P.
# No se ejecuta solo: lo sourcean start-dev / run-android / run-ios.
#
# POR QUE EXISTE EL EXPORT DE LANG:
# la shell del PO corre con LANG="" y CocoaPods revienta con eso
# ("Unicode Normalization not appropriate for ASCII-8BIT").
# Cualquier cosa que toque pod install lo necesita seteado.

export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"

PROJECT_DIR="${0:A:h}"
METRO_PORT=8081

# en0 es Wi-Fi en la mayoria de las Macs; en1 es el fallback (ethernet/USB).
lan_ip() {
  ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo ""
}

metro_url() {
  local ip="$(lan_ip)"
  [[ -n "$ip" ]] && echo "http://${ip}:${METRO_PORT}" || echo ""
}

# Metro escuchando? Sirve para avisar antes de compilar al pedo.
metro_running() {
  lsof -nP -iTCP:${METRO_PORT} -sTCP:LISTEN >/dev/null 2>&1
}

titulo() {
  clear 2>/dev/null || true
  echo "SplitP2P — $1"
  echo "────────────────────────────────────────────────"
}

# Deja la ventana abierta cuando se hace doble click desde Finder,
# para poder leer el error en lugar de ver la ventana cerrarse.
pausa_al_salir() {
  echo
  echo "(Enter para cerrar)"
  read -r _
}
