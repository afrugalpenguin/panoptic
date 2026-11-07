#!/usr/bin/env bash
# Starts a throwaway PostgreSQL 17 that only accepts client certificate sign-in (#120), for the sidecar's
# certificate integration tests (ClientCertificateIntegrationTests). Everything is synthetic and lasts two days:
# a test CA, a server certificate for localhost and 127.0.0.1, and a client certificate for the role "reader", as a
# PEM key, a passphrase-protected key and a .pfx. Usage: scripts/pg-client-cert.sh <dir> [port]. Then set
# PANOPTIC_TEST_PG_CERT_DIR=<dir> (and PANOPTIC_TEST_PG_CERT_PORT if not 15433) and run the PgIntegration tests.
# Remove it with: docker rm -f panoptic-pg-cert
set -euo pipefail
# Git Bash on Windows would rewrite "/CN=..." and container paths as Windows paths.
export MSYS_NO_PATHCONV=1
dir="${1:?usage: pg-client-cert.sh <dir> [port]}"
port="${2:-15433}"
pass="synthetic-passphrase"
mkdir -p "$dir"
cd "$dir"

openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 2 -subj "/CN=Panoptic test CA" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=localhost" 2>/dev/null
printf "subjectAltName=DNS:localhost,IP:127.0.0.1\n" > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 2 -extfile server.ext 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout reader.key -out reader.csr -subj "/CN=reader" 2>/dev/null
openssl x509 -req -in reader.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out reader.crt -days 2 2>/dev/null
openssl pkey -in reader.key -out reader-locked.key -aes256 -passout "pass:$pass"
openssl pkcs12 -export -in reader.crt -inkey reader.key -certfile ca.crt -out reader.pfx -passout "pass:$pass"

# Certificate sign-in only over TLS; the image's init scripts use the local socket.
printf "local all all trust\nhostssl all all all cert clientcert=verify-full\n" > pg_hba.conf
printf "CREATE ROLE reader LOGIN;\n" > init.sql

src="$dir"
if command -v cygpath >/dev/null 2>&1; then src="$(cygpath -w "$dir")"; fi
docker rm -f panoptic-pg-cert >/dev/null 2>&1 || true
# The server's key must belong to the postgres user, which a bind mount cannot give, so the files are copied in first.
docker run -d --name panoptic-pg-cert -p "127.0.0.1:$port:5432" -e POSTGRES_PASSWORD=unused -v "$src:/src:ro" \
  --entrypoint sh postgres:17 -c '
    mkdir -p /certs /docker-entrypoint-initdb.d &&
    cp /src/server.crt /src/server.key /src/ca.crt /src/pg_hba.conf /certs/ &&
    cp /src/init.sql /docker-entrypoint-initdb.d/ &&
    chown -R postgres /certs && chmod 600 /certs/server.key &&
    exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/certs/server.crt -c ssl_key_file=/certs/server.key \
      -c ssl_ca_file=/certs/ca.crt -c hba_file=/certs/pg_hba.conf' >/dev/null

for _ in $(seq 1 30); do
  if docker exec panoptic-pg-cert pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    # The entrypoint's first server is a temporary one; wait for the role from init.sql on the real one.
    if docker exec panoptic-pg-cert psql -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'reader'" 2>/dev/null | grep -q 1; then
      echo "PostgreSQL with client certificate sign-in is up on 127.0.0.1:$port (files in $dir)"
      exit 0
    fi
  fi
  sleep 2
done
docker logs panoptic-pg-cert
echo "PostgreSQL did not become ready" >&2
exit 1
