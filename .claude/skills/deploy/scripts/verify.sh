#!/usr/bin/env bash
# Verifica el despliegue DESDE FUERA (como lo ve un usuario real) y, por
# separado, el ORIGEN saltándose Cloudflare.
#
# Por qué las dos capas por separado: el 2026-07-14 el navegador daba
# `too many redirections` y el origen estaba PERFECTO — la zona de Cloudflare
# estaba en SSL «Flexible», así que CF hablaba HTTP contra un origen que
# redirige a HTTPS, y el bucle lo creaba el borde, no la app. Se perdió una hora
# mirando el sitio equivocado. Si solo pruebas el dominio público no sabes CUÁL
# de las dos capas está rota; probando ambas, el diagnóstico es inmediato.
#
# Uso:  ./verify.sh            # verificación completa
#       ./verify.sh --quick    # solo el dominio público (tras un redeploy)
#
# Salida: exit 0 si todo pasa; 1 si algo falla (imprime QUÉ capa y QUÉ hacer).
set -uo pipefail

DOMAIN="${UGC_DOMAIN:-ugc.carlosvillu.dev}"
VPS_IP="${UGC_VPS_IP:-80.190.75.149}"
SSH_HOST="${UGC_SSH:-developer@$VPS_IP}"
REMOTE_DIR="${UGC_REMOTE_DIR:-/home/developer/projects/ugc-factory}"
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

fails=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails + 1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ── Capa 1: el dominio público (Cloudflare → Caddy → app) ────────────────────
head_ "Dominio público — https://$DOMAIN"

# -L NO: queremos ver el 307 crudo, no seguirlo. Un bucle de redirecciones se
# delata aquí (código 3xx apuntándose a sí mismo).
root_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/" 2>/dev/null)
root_loc=$(curl -sS -o /dev/null -w '%{redirect_url}' --max-time 15 "https://$DOMAIN/" 2>/dev/null)
if [ "$root_code" = "307" ] && [[ "$root_loc" == *"/login"* ]]; then
  ok "GET / → 307 → /login (la app exige sesión, correcto)"
elif [[ "$root_loc" == "https://$DOMAIN/" ]]; then
  bad "BUCLE DE REDIRECCIONES: / → sí mismo (HTTP $root_code)"
  echo "     → Causa casi segura: la zona de Cloudflare está en SSL «Flexible»."
  echo "       CF habla HTTP con el origen, el origen redirige a HTTPS, y así sin fin."
  echo "       ARREGLO (solo el humano, en el dashboard de Cloudflare):"
  echo "       SSL/TLS → Overview → cambiar a «Full (strict)»."
else
  bad "GET / → HTTP $root_code (esperado 307 a /login)"
fi

login_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/login" 2>/dev/null)
[ "$login_code" = "200" ] && ok "GET /login → 200" || bad "GET /login → HTTP $login_code (esperado 200)"

health=$(curl -sS --max-time 15 "https://$DOMAIN/api/health" 2>/dev/null)
if [ "$health" = '{"ok":true,"db":true}' ]; then
  ok "GET /api/health → ok:true, db:true (la BD responde end-to-end)"
else
  bad "GET /api/health → ${health:-<sin respuesta>}"
  echo "     → db:false ⇒ la app vive pero NO habla con Postgres (mira los logs de web)."
fi

[ "$QUICK" = "1" ] && { head_ "Resultado"; [ "$fails" -eq 0 ] && { ok "deploy OK"; exit 0; } || { bad "$fails fallo(s)"; exit 1; }; }

# ── Capa 2: el ORIGEN, saltándose Cloudflare ─────────────────────────────────
# --resolve fuerza a curl a ir a la IP del VPS manteniendo el SNI del dominio,
# así el certificado sigue validando. Si esto pasa y la capa 1 falla, el
# problema es de Cloudflare y NO del servidor.
head_ "Origen directo (sin Cloudflare) — https://$VPS_IP"

origin_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
  --resolve "$DOMAIN:443:$VPS_IP" "https://$DOMAIN/" 2>/dev/null)
tls_ok=$(curl -sS -o /dev/null -w '%{ssl_verify_result}' --max-time 15 \
  --resolve "$DOMAIN:443:$VPS_IP" "https://$DOMAIN/" 2>/dev/null)
[ "$tls_ok" = "0" ] && ok "certificado TLS del origen: VÁLIDO" \
                    || bad "certificado TLS del origen inválido (código $tls_ok)"
[ "$origin_code" = "307" ] && ok "origen responde 307 → /login (Caddy y la app, vivos)" \
                           || bad "origen responde HTTP $origin_code"

# ── Capa 3: los contenedores, por SSH ────────────────────────────────────────
head_ "Contenedores en el VPS"
ps_out=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" \
  'docker ps --format "{{.Names}}|{{.Status}}"' 2>/dev/null)
if [ -z "$ps_out" ]; then
  bad "no se pudo consultar Docker por SSH ($SSH_HOST)"
else
  for c in ugc-factory-web-1 ugc-factory-worker-1 ugc-factory-postgres-1 edge-caddy; do
    line=$(printf '%s\n' "$ps_out" | grep "^$c|" || true)
    if [ -z "$line" ]; then
      bad "$c NO está corriendo"
    else
      status="${line#*|}"
      case "$status" in
        *unhealthy*) bad "$c → $status" ;;
        Up*)         ok "$c → $status" ;;
        *)           bad "$c → $status" ;;
      esac
    fi
  done
fi

# ── Capa 4: ¿qué código corre ahí? ───────────────────────────────────────────
# "¿Lo que está en producción es lo que tengo delante?" Con rsync y sin push, es
# LA pregunta estructural de este setup. redeploy.sh deja la huella en .deployed.
head_ "Código desplegado"
deployed=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" \
  "cat $REMOTE_DIR/.deployed 2>/dev/null" 2>/dev/null || true)
if [ -z "$deployed" ]; then
  printf '  \033[33m?\033[0m sin huella (.deployed): el último deploy no la dejó — no se puede saber qué corre\n'
else
  dep_sha=$(printf '%s\n' "$deployed" | sed -n 's/^sha=//p')
  dep_at=$(printf '%s\n' "$deployed" | sed -n 's/^at=//p')
  local_sha=$(git rev-parse --short HEAD 2>/dev/null || echo '?')
  if [ "$dep_sha" = "$local_sha" ]; then
    ok "producción = tu HEAD ($dep_sha, desplegado $dep_at)"
  else
    printf '  \033[33m⚠\033[0m producción corre \033[1m%s\033[0m y tu HEAD es \033[1m%s\033[0m (desplegado %s)\n' \
      "$dep_sha" "$local_sha" "$dep_at"
    echo "     → hay deriva: lo que ves en local NO es lo que sirve el servidor."
  fi
fi

# ── Capa 5: salud, no solo «responde» ────────────────────────────────────────
# "¿Está bien?" y "¿responde?" no son la misma pregunta. Un contenedor healthy
# puede estar escupiendo errores, con el disco lleno o con backups parados.
head_ "Salud"
errs=$(ssh -o BatchMode=yes "$SSH_HOST" \
  "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml logs --tail 200 web worker 2>/dev/null \
   | grep -icE '\"level\":(50|60)|EROFS|FATAL' || true" 2>/dev/null)
if [ "${errs:-0}" -eq 0 ]; then
  ok "sin errores en los últimos 200 registros de web/worker"
else
  bad "$errs línea(s) de error/fatal en los logs recientes de web/worker"
  echo "     → míralos: ssh $SSH_HOST 'cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml logs --tail 50 web'"
fi

disk=$(ssh -o BatchMode=yes "$SSH_HOST" "df -h / | awk 'NR==2{print \$5}' | tr -d '%'" 2>/dev/null)
if [ -n "$disk" ] && [ "$disk" -lt 85 ]; then
  ok "disco al ${disk}%"
else
  bad "disco al ${disk:-?}% — Postgres y los assets se quedan sin sitio"
fi

# El backup más reciente: un cron que dejó de correr es invisible hasta que lo
# necesitas. Aviso si el último dump tiene más de 48 h (el cron es diario).
age=$(ssh -o BatchMode=yes "$SSH_HOST" \
  "find /home/developer/backups/ugc-factory -name '*.dump' -mtime -2 2>/dev/null | wc -l" 2>/dev/null)
if [ "${age:-0}" -gt 0 ]; then
  ok "hay backup de las últimas 48 h"
else
  bad "NINGÚN backup en las últimas 48 h — ¿ha dejado de correr el cron?"
  echo "     → fuerza uno: .claude/skills/deploy/scripts/backup.sh"
fi

head_ "Resultado"
if [ "$fails" -eq 0 ]; then
  printf '  \033[32m✓ deploy verificado: la app responde en https://%s\033[0m\n' "$DOMAIN"
  exit 0
fi
printf '  \033[31m✗ %s comprobación(es) fallaron\033[0m\n' "$fails"
echo "  Pista: si el ORIGEN pasa y el DOMINIO PÚBLICO falla, el problema es de"
echo "  Cloudflare (no toques el servidor). Si falla el origen, mira los logs:"
echo "    ssh $SSH_HOST 'cd ~/projects/ugc-factory && docker compose -f docker-compose.prod.yml logs --tail 50 web'"
exit 1
