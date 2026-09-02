#!/bin/zsh
# TERMINAL 2 — Android. Compila e instala; NO levanta Metro.
# Metro va en start-dev.command, en su propia ventana.

set -uo pipefail
source "${0:A:h}/dev-env.sh"
cd "$PROJECT_DIR" || exit 1

titulo "Android"

if ! command -v adb >/dev/null 2>&1; then
  echo "❌ adb no esta en el PATH y no lo encontre en ${ANDROID_HOME}."
  echo "   Instala el SDK de Android (Android Studio) o exporta ANDROID_HOME."
  pausa_al_salir
  exit 1
fi

if ! metro_running; then
  echo "⚠️  No hay nada escuchando en el puerto ${METRO_PORT}."
  echo "   Arranca primero start-dev.command en otra ventana."
  echo
  printf "¿Sigo igual? [s/N] "
  read -r r
  [[ "$r" == "s" || "$r" == "S" ]] || exit 1
  echo
fi

# Un device fisico aparece como 'device'; 'unauthorized' = falta aceptar
# el dialogo de depuracion USB en la pantalla del telefono.
DEVICES=$(adb devices | awk 'NR>1 && $2=="device" {print $1}')
UNAUTH=$(adb devices | awk 'NR>1 && $2=="unauthorized" {print $1}')

if [[ -n "$UNAUTH" ]]; then
  echo "⚠️  Hay un device en 'unauthorized': ${UNAUTH}"
  echo "   Desbloquea el telefono y acepta 'Permitir depuracion USB'."
  echo
fi

if [[ -z "$DEVICES" ]]; then
  echo "No hay ningun device ni emulador corriendo."
  echo
  AVDS=("${(@f)$(emulator -list-avds 2>/dev/null)}")
  if [[ ${#AVDS[@]} -eq 0 || -z "${AVDS[1]}" ]]; then
    echo "❌ Tampoco hay AVDs. Conecta un telefono por USB o crea un emulador."
    pausa_al_salir
    exit 1
  fi

  echo "AVDs disponibles:"
  for i in {1..${#AVDS[@]}}; do echo "  $i) ${AVDS[$i]}"; done
  echo
  printf "¿Cual arranco? [1] "
  read -r sel
  [[ -z "$sel" ]] && sel=1
  # :- porque con set -u un indice fuera de rango aborta en vez de dar vacio
  AVD="${AVDS[$sel]:-}"
  if [[ -z "$AVD" ]]; then
    echo "❌ Opcion invalida."
    pausa_al_salir
    exit 1
  fi

  echo "Arrancando ${AVD}..."
  emulator -avd "$AVD" >/dev/null 2>&1 &

  echo -n "Esperando a que el emulador termine de bootear"
  # adb wait-for-device vuelve apenas responde el daemon, mucho antes de que
  # el sistema este usable. sys.boot_completed es la senal real.
  adb wait-for-device
  for _ in {1..60}; do
    [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]] && break
    echo -n "."
    sleep 2
  done
  echo " listo."
  echo
  DEVICES=$(adb devices | awk 'NR>1 && $2=="device" {print $1}')
fi

# Con varios devices conectados adb necesita saber a cual hablarle.
COUNT=$(echo "$DEVICES" | grep -c . )
if [[ "$COUNT" -gt 1 ]]; then
  echo "Hay mas de un device conectado:"
  echo "$DEVICES" | nl -w2 -s') '
  echo
  printf "¿A cual instalo? [1] "
  read -r sel
  [[ -z "$sel" ]] && sel=1
  TARGET=$(echo "$DEVICES" | sed -n "${sel}p")
else
  TARGET=$(echo "$DEVICES" | head -1)
fi

[[ -z "$TARGET" ]] && { echo "❌ No pude resolver el device."; pausa_al_salir; exit 1; }
echo "Device: ${TARGET}"

# El telefono no alcanza la IP de la Mac por USB: reverse mapea su
# localhost:8081 al Metro de la Mac. En emulador tambien funciona y no molesta.
adb -s "$TARGET" reverse tcp:${METRO_PORT} tcp:${METRO_PORT} >/dev/null 2>&1 \
  && echo "adb reverse ${METRO_PORT} → OK" \
  || echo "⚠️  adb reverse fallo (el device igual puede llegar por Wi-Fi)"
echo

# --no-bundler es lo que evita que run:android levante un SEGUNDO Metro
# y los dos se peleen por el 8081.
echo "Compilando e instalando (la primera vez tarda varios minutos)..."
echo
npx expo run:android --no-bundler --device "$TARGET"
STATUS=$?

echo
if [[ $STATUS -eq 0 ]]; then
  echo "✅ Instalada. Para las proximas corridas NO hace falta volver a compilar:"
  echo "   abris la app en el device y listo. Solo recompilas si tocas codigo"
  echo "   nativo o dependencias."
else
  echo "❌ El build fallo (exit ${STATUS}). El error real esta mas arriba."
fi
pausa_al_salir
