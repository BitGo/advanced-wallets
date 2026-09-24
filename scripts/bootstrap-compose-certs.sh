#!/usr/bin/env bash
# Development bootstrap only: replace this CA and its certificates for production.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

if [[ -e deploy/certs || -e deploy/ca || -e deploy/clients ]]; then
  echo 'deploy credentials already exist; refusing to overwrite them' >&2
  exit 1
fi
if [[ $(id -u) -eq 0 ]]; then
  echo 'Run the bootstrap as an unprivileged user so containers can read its private keys without running as root' >&2
  exit 1
fi
mkdir -p deploy logs
chmod 700 logs
work=$(mktemp -d deploy/.bootstrap.XXXXXX)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/ca" "$work/certs/awm" "$work/certs/mbe" "$work/clients"

openssl req -x509 -newkey rsa:3072 -nodes -days 30 -sha256 \
  -keyout "$work/ca/ca.key" -out "$work/ca/ca.crt" \
  -subj '/CN=Advanced Wallets local development CA'

issue_cert() {
  local dir=$1 name=$2 cn=$3 usage=$4 san=$5
  openssl req -newkey rsa:3072 -nodes -sha256 \
    -keyout "$dir/$name.key" -out "$work/$name.csr" -subj "/CN=$cn"
  printf 'subjectAltName=%s\nextendedKeyUsage=%s\n' "$san" "$usage" > "$work/$name.ext"
  openssl x509 -req -in "$work/$name.csr" -CA "$work/ca/ca.crt" \
    -CAkey "$work/ca/ca.key" -CAcreateserial -out "$dir/$name.crt" \
    -days 30 -sha256 -extfile "$work/$name.ext"
}

issue_cert "$work/certs/awm" awm-server advanced-wallet-manager serverAuth 'DNS:advanced-wallet-manager'
issue_cert "$work/certs/mbe" mbe-server localhost serverAuth 'DNS:localhost,IP:127.0.0.1'
issue_cert "$work/certs/mbe" mbe-awm-client mbe-awm-client clientAuth 'DNS:mbe-awm-client'
issue_cert "$work/certs/awm" awm-key-provider-client awm-key-provider-client clientAuth 'DNS:awm-key-provider-client'
issue_cert "$work/clients" mbe-client mbe-client clientAuth 'DNS:mbe-client'
cp "$work/ca/ca.crt" "$work/certs/awm/ca.crt"
cp "$work/ca/ca.crt" "$work/certs/mbe/ca.crt"

fingerprint() {
  openssl x509 -in "$1" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':'
}
{
  printf 'AWM_ALLOWED_CLIENT_FINGERPRINTS=%s\n' "$(fingerprint "$work/certs/mbe/mbe-awm-client.crt")"
  printf 'MBE_ALLOWED_CLIENT_FINGERPRINTS=%s\n' "$(fingerprint "$work/clients/mbe-client.crt")"
  printf 'COMPOSE_UID=%s\nCOMPOSE_GID=%s\n' "$(id -u)" "$(id -g)"
} > "$work/certs/fingerprints.env"

mv "$work/ca" "$work/certs" "$work/clients" deploy/
rm -rf "$work"
trap - EXIT
printf '%s\n' 'Generated 30-day local certificates under deploy/. Supply deploy/certs/awm/key-provider-ca.pem from your key provider before starting.'
