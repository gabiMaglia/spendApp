#!/usr/bin/env bash
# Arnés de integración de T-147: levanta Supabase LOCAL limpio y aplica las
# migraciones del repo hasta la etapa pedida. NUNCA apunta al proyecto real:
# todo corre contra los contenedores de `tools/supabase-int` (puertos 553xx).
#
#   scripts/supabase-int.sh 010    # el buzón como está hoy en producción
#   scripts/supabase-int.sh 011a   # + la migración aditiva
#   scripts/supabase-int.sh 011b   # + el corte
#
# Escribe `tools/supabase-int/int.env` (gitignored) para `npm run test:int`.
# Requiere docker (colima sirve) y red para `npx supabase@2` la primera vez.
set -euo pipefail

STAGE="${1:?uso: scripts/supabase-int.sh 010|011a|011b}"
case "$STAGE" in 010|011a|011b) ;; *) echo "etapa inválida: $STAGE" >&2; exit 2 ;; esac

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
WD="$RAIZ/tools/supabase-int"
SUPA=(npx --yes supabase@2 --workdir "$WD")
DB="supabase_db_splitp2p-int"

command -v docker >/dev/null || { echo "falta docker (colima start)" >&2; exit 1; }

"${SUPA[@]}" start >/dev/null
"${SUPA[@]}" db reset --no-seed >/dev/null

# `psql` corre DENTRO del contenedor (no hay psql local) y como `postgres`, que
# es el mismo rol con el que el PO pega las migraciones en el SQL editor.
aplicar() {
  echo "  aplicando $(basename "$1")"
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$DB" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q < "$1"
}

for f in 001_mailbox 002_error_clarity 003_device_keys 004_compaction 005_claves_por_owner \
         006_payload_limit 007_ttl_cron 008_owner_tag 009_owner_tag_only 010_ckey_compaction; do
  aplicar "$RAIZ/supabase/$f.sql"
done
if [[ "$STAGE" == "011a" || "$STAGE" == "011b" ]]; then aplicar "$RAIZ/supabase/011a_relay_rls_aditiva.sql"; fi
if [[ "$STAGE" == "011b" ]]; then aplicar "$RAIZ/supabase/011b_relay_rls_corte.sql"; fi

# `db reset` reinicia Realtime y Auth: hasta que estén sanos, el primer canal
# privado sale «Unauthorized» (visto con stack recién reseteado).
esperar_sano() {
  local c="$1" i
  for i in $(seq 1 90); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" == "healthy" ]] && return 0
    sleep 2
  done
  echo "timeout esperando $c" >&2; return 1
}
esperar_sano supabase_realtime_splitp2p-int
esperar_sano supabase_auth_splitp2p-int

"${SUPA[@]}" status -o env | awk -F= -v st="$STAGE" '
  $1=="API_URL"{print "SUPA_INT_URL="$2}
  $1=="ANON_KEY"{print "SUPA_INT_ANON="$2}
  $1=="SERVICE_ROLE_KEY"{print "SUPA_INT_SERVICE="$2}
  END{print "SUPA_INT_STAGE="st}' | tr -d '"' > "$WD/int.env"

echo "OK etapa $STAGE → $WD/int.env"
