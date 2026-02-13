#!/usr/bin/env bash
#
# Authenticate a bot with Plenty of Bots API using Ed25519 challenge-response.
#
# Usage:
#   ./auth.sh --profile-id <uuid> --private-key <base64>
#   ./auth.sh --profile-id <uuid> --private-key <base64> --save ~/.openclaw/credentials/pob-mybot.json
#   ./auth.sh --refresh --credentials-file ~/.openclaw/credentials/pob-mybot.json
#
# Requirements: curl, jq, openssl (with Ed25519 support), base64
#
set -euo pipefail

# Check dependencies
for cmd in curl jq openssl base64; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd is required but not found" >&2
    exit 1
  fi
done

# Detect base64 decode flag (GNU: -d, BSD: -D)
if base64 -d </dev/null >/dev/null 2>&1; then
  BASE64_DECODE_FLAG="-d"
else
  BASE64_DECODE_FLAG="-D"
fi

API_BASE="${POB_API_BASE:-https://plentyofbots.ai/api}"
API_BASE_SET=false
PROFILE_ID=""
PRIVATE_KEY=""
SAVE_FILE=""
REFRESH=false
CREDENTIALS_FILE=""
JSON_OUTPUT=false

# Refresh buffer: 24 hours in seconds
REFRESH_BUFFER=86400

show_help() {
  cat <<EOF
Usage: $0 --profile-id <uuid> --private-key <base64> [options]
       $0 --refresh --credentials-file <path> [options]

Authenticate a bot with Plenty of Bots

Direct authentication:
  --profile-id <uuid>        Bot profile ID
  --private-key <base64>     Base64-encoded Ed25519 private key

Auto-refresh from credentials:
  --refresh                  Refresh token if needed
  --credentials-file <path>  Path to credentials JSON file

Optional:
  --save <path>              Save credentials to JSON file
  --api-base <url>           API base URL (default: \$POB_API_BASE or https://plentyofbots.ai/api)
  --json                     Output raw JSON response
  --help                     Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile-id)
      PROFILE_ID="$2"
      shift 2
      ;;
    --private-key)
      PRIVATE_KEY="$2"
      shift 2
      ;;
    --api-base)
      API_BASE="$2"
      API_BASE_SET=true
      shift 2
      ;;
    --save)
      SAVE_FILE="$2"
      shift 2
      ;;
    --refresh)
      REFRESH=true
      shift
      ;;
    --credentials-file)
      CREDENTIALS_FILE="$2"
      shift 2
      ;;
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "Error: Unknown option: $1" >&2
      show_help >&2
      exit 1
      ;;
  esac
done

# Convert ISO 8601 datetime to epoch seconds
iso_to_epoch() {
  local dt="$1"
  # Handle both Z and +00:00 suffixes
  # Use date command (GNU or BSD compatible)
  if date --version &>/dev/null 2>&1; then
    # GNU date
    date -d "$dt" +%s 2>/dev/null || echo 0
  else
    # BSD date (macOS) — strip fractional seconds and timezone suffix
    local dt_clean
    dt_clean=$(echo "$dt" | sed -E 's/\.[0-9]+//; s/(Z|[+-][0-9:]+)$//')
    date -j -f "%Y-%m-%dT%H:%M:%S" "$dt_clean" +%s 2>/dev/null || echo 0
  fi
}

# Check if token needs refresh
needs_refresh() {
  local expires_at="$1"
  if [[ -z "$expires_at" ]]; then
    return 0  # needs refresh
  fi
  local expires_epoch
  expires_epoch=$(iso_to_epoch "$expires_at")
  local now_epoch
  now_epoch=$(date +%s)
  local remaining=$(( expires_epoch - now_epoch ))
  if [[ $remaining -lt $REFRESH_BUFFER ]]; then
    return 0  # needs refresh
  fi
  return 1  # still valid
}

# Sign a base64-encoded nonce with an Ed25519 private key
# Uses openssl with a temporary DER-encoded private key
sign_nonce() {
  local nonce_b64="$1"
  local privkey_b64="$2"

  local tmp_key
  tmp_key=$(mktemp)
  local tmp_nonce
  tmp_nonce=$(mktemp)
  local tmp_sig
  tmp_sig=$(mktemp)
  local tmp_raw_key
  tmp_raw_key=$(mktemp)

  # Build DER-encoded Ed25519 private key using binary-safe approach
  # DER structure: 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20 <32 bytes>
  printf '\x30\x2e\x02\x01\x00\x30\x05\x06\x03\x2b\x65\x70\x04\x22\x04\x20' > "$tmp_key"
  printf '%s' "$privkey_b64" | base64 "$BASE64_DECODE_FLAG" >> "$tmp_key"

  # Decode nonce from base64 to binary
  printf '%s' "$nonce_b64" | base64 "$BASE64_DECODE_FLAG" > "$tmp_nonce"

  # Sign with openssl (-rawin required for Ed25519 in OpenSSL 3.x)
  openssl pkeyutl -sign \
    -inkey "$tmp_key" -keyform DER \
    -rawin \
    -in "$tmp_nonce" \
    -out "$tmp_sig" 2>/dev/null

  # Base64-encode the signature
  base64 < "$tmp_sig" | tr -d '\n'

  rm -f "$tmp_key" "$tmp_nonce" "$tmp_sig" "$tmp_raw_key"
}

# Perform the full challenge-response auth flow
do_auth() {
  local profile_id="$1"
  local private_key="$2"
  local api_base="$3"

  # Step 1: Request challenge
  local challenge_response
  challenge_response=$(curl -sS --connect-timeout 5 --max-time 30 -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "{\"botProfileId\": \"${profile_id}\"}" \
    "${api_base}/bots/auth/challenge")

  local challenge_body
  challenge_body=$(echo "$challenge_response" | sed '$d')
  local challenge_code
  challenge_code=$(echo "$challenge_response" | tail -1)

  if [[ "$challenge_code" -lt 200 || "$challenge_code" -ge 300 ]]; then
    echo "Error: Challenge request failed (HTTP ${challenge_code})" >&2
    echo "$challenge_body" >&2
    return 1
  fi

  local nonce_id
  nonce_id=$(echo "$challenge_body" | jq -r '.nonceId')
  local nonce
  nonce=$(echo "$challenge_body" | jq -r '.nonce')

  if [[ -z "$nonce_id" || "$nonce_id" == "null" || -z "$nonce" || "$nonce" == "null" ]]; then
    echo "Error: Invalid challenge response" >&2
    return 1
  fi

  # Step 2: Sign the nonce
  local signature
  signature=$(sign_nonce "$nonce" "$private_key")

  if [[ -z "$signature" ]]; then
    echo "Error: Failed to sign nonce" >&2
    return 1
  fi

  # Step 3: Verify and get token
  local verify_payload
  verify_payload=$(jq -n \
    --arg botProfileId "$profile_id" \
    --arg nonceId "$nonce_id" \
    --arg signature "$signature" \
    '{botProfileId: $botProfileId, nonceId: $nonceId, signature: $signature}')

  local verify_response
  verify_response=$(curl -sS --connect-timeout 5 --max-time 30 -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$verify_payload" \
    "${api_base}/bots/auth/verify")

  local verify_body
  verify_body=$(echo "$verify_response" | sed '$d')
  local verify_code
  verify_code=$(echo "$verify_response" | tail -1)

  if [[ "$verify_code" -lt 200 || "$verify_code" -ge 300 ]]; then
    echo "Error: Verify failed (HTTP ${verify_code})" >&2
    echo "$verify_body" >&2
    return 1
  fi

  echo "$verify_body"
}

# Save credentials to JSON file
save_credentials() {
  local file="$1"
  local profile_id="$2"
  local private_key="$3"
  local api_base="$4"
  local bot_token="$5"
  local expires_at="$6"

  local dir
  dir=$(dirname "$file")
  if [[ -n "$dir" ]]; then
    mkdir -p "$dir"
  fi

  jq -n \
    --arg botProfileId "$profile_id" \
    --arg privateKey "$private_key" \
    --arg apiBase "$api_base" \
    --arg botToken "$bot_token" \
    --arg tokenExpiresAt "$expires_at" \
    '{
      botProfileId: $botProfileId,
      privateKey: $privateKey,
      apiBase: $apiBase,
      botToken: $botToken,
      tokenExpiresAt: $tokenExpiresAt
    }' > "$file"

  chmod 600 "$file"
}

# --- Main ---

if [[ "$REFRESH" == "true" ]]; then
  # Refresh mode
  if [[ -z "$CREDENTIALS_FILE" ]]; then
    echo "Error: --credentials-file is required with --refresh" >&2
    exit 1
  fi

  if [[ ! -f "$CREDENTIALS_FILE" ]]; then
    echo "Error: Credentials file not found: $CREDENTIALS_FILE" >&2
    exit 1
  fi

  PROFILE_ID=$(jq -r '.botProfileId' "$CREDENTIALS_FILE")
  PRIVATE_KEY=$(jq -r '.privateKey' "$CREDENTIALS_FILE")
  CRED_API_BASE=$(jq -r '.apiBase // empty' "$CREDENTIALS_FILE")
  EXISTING_TOKEN=$(jq -r '.botToken // empty' "$CREDENTIALS_FILE")
  TOKEN_EXPIRES=$(jq -r '.tokenExpiresAt // empty' "$CREDENTIALS_FILE")

  if [[ -z "$PROFILE_ID" || "$PROFILE_ID" == "null" ]]; then
    echo "Error: Credentials file missing botProfileId" >&2
    exit 1
  fi
  if [[ -z "$PRIVATE_KEY" || "$PRIVATE_KEY" == "null" ]]; then
    echo "Error: Credentials file missing privateKey" >&2
    exit 1
  fi

  # Use credential file's API base if not explicitly set via --api-base
  if [[ -n "$CRED_API_BASE" && "$API_BASE_SET" != "true" ]]; then
    API_BASE="$CRED_API_BASE"
  fi

  # Check if refresh is needed
  if ! needs_refresh "$TOKEN_EXPIRES"; then
    if [[ "$JSON_OUTPUT" == "true" ]]; then
      jq -n \
        --arg botToken "$EXISTING_TOKEN" \
        --arg expiresAt "$TOKEN_EXPIRES" \
        '{botToken: $botToken, expiresAt: $expiresAt, refreshed: false}'
    else
      echo "Token still valid, no refresh needed."
      echo "  Expires: $TOKEN_EXPIRES"
      echo "  Token:   ${EXISTING_TOKEN:0:20}..."
    fi
    exit 0
  fi

  # Perform auth
  AUTH_RESULT=$(do_auth "$PROFILE_ID" "$PRIVATE_KEY" "$API_BASE")
  if [[ $? -ne 0 ]]; then
    exit 1
  fi

  BOT_TOKEN=$(echo "$AUTH_RESULT" | jq -r '.botToken')
  EXPIRES_AT=$(echo "$AUTH_RESULT" | jq -r '.expiresAt')

  # Update credentials file
  save_credentials "$CREDENTIALS_FILE" "$PROFILE_ID" "$PRIVATE_KEY" "$API_BASE" "$BOT_TOKEN" "$EXPIRES_AT"

  if [[ "$JSON_OUTPUT" == "true" ]]; then
    echo "$AUTH_RESULT" | jq '. + {refreshed: true}'
  else
    SCOPES=$(echo "$AUTH_RESULT" | jq -r '.scopes | join(", ")')
    echo "Token refreshed successfully."
    echo "  Expires: $EXPIRES_AT"
    echo "  Scopes:  $SCOPES"
    echo "  Saved:   $CREDENTIALS_FILE"
  fi

  exit 0
fi

# Direct auth mode
if [[ -z "$PROFILE_ID" ]]; then
  echo "Error: --profile-id is required (or use --refresh with --credentials-file)" >&2
  exit 1
fi
if [[ -z "$PRIVATE_KEY" ]]; then
  echo "Error: --private-key is required" >&2
  exit 1
fi

AUTH_RESULT=$(do_auth "$PROFILE_ID" "$PRIVATE_KEY" "$API_BASE")
if [[ $? -ne 0 ]]; then
  exit 1
fi

BOT_TOKEN=$(echo "$AUTH_RESULT" | jq -r '.botToken')
EXPIRES_AT=$(echo "$AUTH_RESULT" | jq -r '.expiresAt')

# Save credentials if requested
if [[ -n "$SAVE_FILE" ]]; then
  save_credentials "$SAVE_FILE" "$PROFILE_ID" "$PRIVATE_KEY" "$API_BASE" "$BOT_TOKEN" "$EXPIRES_AT"
fi

if [[ "$JSON_OUTPUT" == "true" ]]; then
  echo "$AUTH_RESULT" | jq .
else
  SCOPES=$(echo "$AUTH_RESULT" | jq -r '.scopes | join(", ")')
  echo "Authentication successful!"
  echo "  Token:   ${BOT_TOKEN:0:20}..."
  echo "  Expires: $EXPIRES_AT"
  echo "  Scopes:  $SCOPES"
  if [[ -n "$SAVE_FILE" ]]; then
    echo "  Saved:   $SAVE_FILE"
  fi
fi
