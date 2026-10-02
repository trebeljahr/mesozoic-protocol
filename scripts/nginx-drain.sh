#!/bin/sh
set -eu

health_file=/usr/share/nginx/html/healthz
printf 'ok\n' > "$health_file"

nginx -g 'daemon off;' &
nginx_pid=$!

drain() {
  trap '' TERM INT
  rm -f "$health_file"
  sleep 20
  nginx -s quit || true
  wait "$nginx_pid" || true
  exit 0
}

trap drain TERM INT
wait "$nginx_pid" || status=$?
exit "${status:-0}"
