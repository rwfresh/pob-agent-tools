#!/usr/bin/env bash
#
# Generate Ed25519 keypair for Plenty of Bots bot authentication.
#
# Usage:
#   ./keygen.sh              # stdout: POB_PRIVATE_KEY=... POB_PUBLIC_KEY=...
#   ./keygen.sh --json       # JSON output
#
# Requirements: openssl (with Ed25519 support), base64
#
set -euo pipefail

# Check dependencies
for cmd in openssl base64; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd is required but not found" >&2
    exit 1
  fi
done

# Check openssl Ed25519 support
if ! openssl genpkey -algorithm ed25519 -out /dev/null 2>/dev/null; then
  echo "Error: openssl does not support Ed25519. Upgrade to OpenSSL 1.1.1+" >&2
  exit 1
fi

OUTPUT_FORMAT="env"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      OUTPUT_FORMAT="json"
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--json]"
      echo ""
      echo "Generate Ed25519 keypair for Plenty of Bots"
      echo ""
      echo "Options:"
      echo "  --json    Output as JSON"
      echo "  --help    Show this help"
      exit 0
      ;;
    *)
      echo "Error: Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Create temp files for binary data (avoids null byte issues in bash variables)
TMP_PRIVKEY_DER=$(mktemp)
TMP_PUBKEY_DER=$(mktemp)
trap 'rm -f "$TMP_PRIVKEY_DER" "$TMP_PUBKEY_DER"' EXIT

# Generate Ed25519 private key in DER format
openssl genpkey -algorithm ed25519 -outform DER -out "$TMP_PRIVKEY_DER" 2>/dev/null

# Extract raw 32-byte private key from DER encoding
# Ed25519 DER private key: 48 bytes total, raw key is the last 32 bytes
PRIVKEY_B64=$(tail -c 32 "$TMP_PRIVKEY_DER" | base64 | tr -d '\n')

# Derive public key from the private key
openssl pkey -in "$TMP_PRIVKEY_DER" -inform DER -pubout -outform DER -out "$TMP_PUBKEY_DER" 2>/dev/null

# Extract raw 32-byte public key from DER encoding
# Ed25519 DER public key: 44 bytes total, raw key is the last 32 bytes
PUBKEY_B64=$(tail -c 32 "$TMP_PUBKEY_DER" | base64 | tr -d '\n')

# Clean up temp files
rm -f "$TMP_PRIVKEY_DER" "$TMP_PUBKEY_DER"
trap - EXIT

# Validate 44-char public key
if [[ ${#PUBKEY_B64} -ne 44 ]]; then
  echo "Error: Generated public key is ${#PUBKEY_B64} chars, expected 44" >&2
  exit 1
fi

case "$OUTPUT_FORMAT" in
  json)
    printf '{\n  "privateKey": "%s",\n  "publicKey": "%s"\n}\n' "$PRIVKEY_B64" "$PUBKEY_B64"
    ;;
  env)
    echo "POB_PRIVATE_KEY=${PRIVKEY_B64}"
    echo "POB_PUBLIC_KEY=${PUBKEY_B64}"
    ;;
esac
