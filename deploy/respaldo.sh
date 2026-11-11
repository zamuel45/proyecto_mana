#!/bin/sh
# =====================================================================
#  Copia de seguridad diaria de PostgreSQL (incluye los usuarios de GoTrue, esquema auth)
#  Uso en el VPS (crontab -e, ver deploy/crontab.txt):
#     30 3 * * * /opt/mana/deploy/respaldo.sh >> /var/log/mana-respaldo.log 2>&1
#  Restaurar en un VPS nuevo:
#     docker compose up -d db
#     docker compose exec -T db pg_restore -U postgres -d mana --clean --if-exists < mana-AAAA-MM-DD.dump
#     docker compose up -d
# =====================================================================
set -e
PROYECTO="${PROYECTO:-/opt/mana}"
DESTINO="${DESTINO:-/var/backups/mana}"
DIAS="${DIAS:-14}"                         # cuántos días de copias se conservan en el VPS
REMOTO="${REMOTO:-}"                       # ej. "gdrive:mana-respaldos" (rclone) para guardar FUERA del VPS

mkdir -p "$DESTINO"
ARCHIVO="$DESTINO/mana-$(date +%F).dump"
cd "$PROYECTO"
docker compose exec -T db pg_dump -U postgres -Fc mana > "$ARCHIVO"
echo "$(date '+%F %T') copia creada: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"

# Copia fuera del VPS (si el servidor completo falla, no se pierden la base y sus copias a la vez)
if [ -n "$REMOTO" ]; then
  rclone copy "$ARCHIVO" "$REMOTO" && echo "$(date '+%F %T') copiada a $REMOTO"
fi

find "$DESTINO" -name 'mana-*.dump' -mtime +"$DIAS" -delete
