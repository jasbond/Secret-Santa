#!/bin/sh
set -e
# Les volumes des hébergeurs (Railway, Fly…) ou les dossiers montés appartiennent
# souvent à root : on donne le dossier de données à l'utilisateur « node ».
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec su-exec node "$@"
fi
exec "$@"
