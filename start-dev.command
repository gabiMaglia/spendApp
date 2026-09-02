#!/bin/zsh
# TERMINAL 1 — Metro, y nada mas.
# Los builds van en otra ventana (run-android.command / run-ios.command),
# que se conectan a ESTE Metro con --no-bundler.

set -uo pipefail
source "${0:A:h}/dev-env.sh"
cd "$PROJECT_DIR" || exit 1

titulo "Metro (dev client)"

if metro_running; then
  echo "⚠️  Ya hay algo escuchando en el puerto ${METRO_PORT}."
  echo "    Probablemente Metro ya este corriendo en otra ventana."
  echo
  echo "    Para matarlo:  lsof -ti tcp:${METRO_PORT} | xargs kill"
  pausa_al_salir
  exit 1
fi

IP="$(lan_ip)"
if [[ -z "$IP" ]]; then
  echo "⚠️  No pude leer la IP de la LAN (en0/en1 sin direccion)."
  echo "    Sin Wi-Fi los telefonos no llegan. Arranco igual, pero si no"
  echo "    conectan, relanzame con:  npx expo start --dev-client --tunnel"
  echo
else
  echo "IP de esta Mac : ${IP}"
  echo "URL para el dev client manual : $(metro_url)"
  echo
fi

echo "Los dos telefonos tienen que estar en la MISMA Wi-Fi que la Mac."
echo "Si no lo estan, cerra esto y corre:  npx expo start --dev-client --tunnel"
echo

# --dev-client y no Expo Go: esta app usa MMKV + modulos nativos,
# en Expo Go no arranca. Sin este flag Expo ofrece el camino equivocado.
exec npx expo start --dev-client --host lan
