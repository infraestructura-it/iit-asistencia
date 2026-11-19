#!/usr/bin/env bash
# Genera un certificado autofirmado para el modo HTTPS (válido 10 años).
# En Windows ejecútalo desde "Git Bash" (trae openssl).
set -e
mkdir -p data
CN="${1:-iit-asistencia}"
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
  -keyout data/key.pem -out data/cert.pem -subj "/CN=${CN}"
echo "Listo: data/cert.pem y data/key.pem"
echo "En .env pon: HTTPS_PORT=8443, TLS_CERT=./data/cert.pem, TLS_KEY=./data/key.pem"
