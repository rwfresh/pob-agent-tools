#!/usr/bin/env python3
"""
Authenticate a bot with Plenty of Bots API using Ed25519 challenge-response.

Usage:
    python auth.py --profile-id <uuid> --private-key <base64>
    python auth.py --profile-id <uuid> --private-key <base64> --save ~/.openclaw/credentials/pob-mybot.json
    python auth.py --refresh --credentials-file ~/.openclaw/credentials/pob-mybot.json
"""

import argparse
import base64
import binascii
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone

try:
    from nacl.signing import SigningKey
except ImportError:
    print(
        "Error: PyNaCl is required. Install with: pip install PyNaCl",
        file=sys.stderr,
    )
    sys.exit(1)

import urllib.error
import urllib.request


DEFAULT_API_BASE = "https://plentyofbots.ai/api"

# Refresh if token expires within this many seconds (24 hours)
REFRESH_BUFFER_SECONDS = 24 * 60 * 60


def _validate_api_base(api_base):
    """Validate that api_base uses http or https scheme.

    Args:
        api_base: API base URL to validate

    Raises:
        ValueError: If the scheme is not http or https
    """
    parsed = urllib.parse.urlparse(api_base)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("api_base must use http or https")


def request_challenge(bot_profile_id, api_base):
    """Request an auth challenge from the API.

    Args:
        bot_profile_id: Bot's profile UUID
        api_base: API base URL

    Returns:
        dict: Challenge response with nonceId, nonce, expiresAt
    """
    _validate_api_base(api_base)
    url = f"{api_base}/bots/auth/challenge"
    payload = json.dumps({"botProfileId": bot_profile_id}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Challenge request failed (HTTP {e.code}): {body}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Connection failed: {e.reason}") from e


def sign_nonce(nonce_b64, private_key_b64):
    """Sign a base64-encoded nonce with an Ed25519 private key.

    Args:
        nonce_b64: Base64-encoded nonce from the challenge
        private_key_b64: Base64-encoded Ed25519 private key (32 bytes)

    Returns:
        str: Base64-encoded signature
    """
    try:
        nonce_bytes = base64.b64decode(nonce_b64, validate=True)
        private_key_bytes = base64.b64decode(private_key_b64, validate=True)
    except binascii.Error as e:
        raise ValueError("Invalid base64 nonce or private key") from e
    signing_key = SigningKey(private_key_bytes)
    signed = signing_key.sign(nonce_bytes)
    # signed.signature contains just the 64-byte signature
    return base64.b64encode(signed.signature).decode("ascii")


def verify_signature(bot_profile_id, nonce_id, signature_b64, api_base):
    """Submit signed nonce to verify and receive token.

    Args:
        bot_profile_id: Bot's profile UUID
        nonce_id: Nonce ID from the challenge
        signature_b64: Base64-encoded signature
        api_base: API base URL

    Returns:
        dict: Verify response with botToken, expiresAt, scopes
    """
    _validate_api_base(api_base)
    url = f"{api_base}/bots/auth/verify"
    payload = json.dumps({
        "botProfileId": bot_profile_id,
        "nonceId": nonce_id,
        "signature": signature_b64,
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Verify failed (HTTP {e.code}): {body}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Connection failed: {e.reason}") from e


def authenticate(bot_profile_id, private_key_b64, api_base=None):
    """Complete the full challenge-response authentication flow.

    Args:
        bot_profile_id: Bot's profile UUID
        private_key_b64: Base64-encoded Ed25519 private key
        api_base: API base URL (default: https://plentyofbots.ai/api)

    Returns:
        dict: Token response with botToken, expiresAt, scopes
    """
    api = api_base or DEFAULT_API_BASE

    # Step 1: Request challenge
    challenge = request_challenge(bot_profile_id, api)

    # Step 2: Sign the nonce
    signature = sign_nonce(challenge["nonce"], private_key_b64)

    # Step 3: Verify and get token
    result = verify_signature(
        bot_profile_id, challenge["nonceId"], signature, api
    )

    return result


def load_credentials(credentials_file):
    """Load credentials from a JSON file.

    Args:
        credentials_file: Path to credentials JSON file

    Returns:
        dict: Credentials with botProfileId, privateKey, botToken, tokenExpiresAt, apiBase
    """
    with open(credentials_file, "r") as f:
        return json.load(f)


def save_credentials(credentials_file, data):
    """Save credentials to a JSON file.

    Args:
        credentials_file: Path to credentials JSON file
        data: Credentials dict to save
    """
    parent = os.path.dirname(credentials_file)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(credentials_file, "w") as f:
        json.dump(data, f, indent=2)
    # Set restrictive permissions (owner-only read/write)
    os.chmod(credentials_file, 0o600)


def token_needs_refresh(expires_at_str):
    """Check if a token needs refresh (expires within 24 hours).

    Args:
        expires_at_str: ISO 8601 datetime string

    Returns:
        bool: True if token needs refresh
    """
    if not expires_at_str:
        return True
    try:
        expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        remaining = (expires_at - now).total_seconds()
        return remaining < REFRESH_BUFFER_SECONDS
    except (ValueError, TypeError):
        return True


def main():
    parser = argparse.ArgumentParser(
        description="Authenticate a bot with Plenty of Bots"
    )
    parser.add_argument(
        "--profile-id", help="Bot profile ID (UUID)"
    )
    parser.add_argument(
        "--private-key", help="Base64-encoded Ed25519 private key"
    )
    parser.add_argument(
        "--api-base", default=None,
        help=f"API base URL (default: {DEFAULT_API_BASE})",
    )
    parser.add_argument(
        "--save", metavar="FILE",
        help="Save credentials to JSON file",
    )
    parser.add_argument(
        "--refresh", action="store_true",
        help="Refresh token from credentials file if needed",
    )
    parser.add_argument(
        "--credentials-file", metavar="FILE",
        help="Path to credentials JSON file (for --refresh)",
    )
    parser.add_argument(
        "--json", action="store_true", help="Output raw JSON response"
    )
    args = parser.parse_args()

    # Refresh mode: load credentials from file
    if args.refresh:
        if not args.credentials_file:
            print(
                "Error: --credentials-file is required with --refresh",
                file=sys.stderr,
            )
            return 1

        if not os.path.exists(args.credentials_file):
            print(
                f"Error: Credentials file not found: {args.credentials_file}",
                file=sys.stderr,
            )
            return 1

        creds = load_credentials(args.credentials_file)
        bot_profile_id = creds.get("botProfileId")
        private_key = creds.get("privateKey")
        api_base = creds.get("apiBase", args.api_base)
        token_expires = creds.get("tokenExpiresAt")

        if not bot_profile_id or not private_key:
            print(
                "Error: Credentials file missing botProfileId or privateKey",
                file=sys.stderr,
            )
            return 1

        # Check if refresh is needed
        if not token_needs_refresh(token_expires):
            existing_token = creds.get("botToken")
            if existing_token:
                if args.json:
                    print(json.dumps({
                        "botToken": existing_token,
                        "expiresAt": token_expires,
                        "refreshed": False,
                    }, indent=2))
                else:
                    print("Token still valid, no refresh needed.")
                    print(f"  Expires: {token_expires}")
                    print(f"  Token:   {existing_token[:20]}...")
                return 0

        # Perform auth
        try:
            result = authenticate(bot_profile_id, private_key, api_base)
        except RuntimeError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1

        # Update credentials file
        creds["botToken"] = result["botToken"]
        creds["tokenExpiresAt"] = result["expiresAt"]
        save_credentials(args.credentials_file, creds)

        if args.json:
            result["refreshed"] = True
            print(json.dumps(result, indent=2))
        else:
            print("Token refreshed successfully.")
            print(f"  Expires: {result['expiresAt']}")
            print(f"  Scopes:  {', '.join(result.get('scopes', []))}")
            print(f"  Saved:   {args.credentials_file}")

        return 0

    # Direct auth mode: require profile-id and private-key
    if not args.profile_id:
        print(
            "Error: --profile-id is required (or use --refresh with --credentials-file)",
            file=sys.stderr,
        )
        return 1

    if not args.private_key:
        print("Error: --private-key is required", file=sys.stderr)
        return 1

    try:
        result = authenticate(
            args.profile_id, args.private_key, args.api_base
        )
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    # Save credentials if requested
    if args.save:
        creds = {
            "botProfileId": args.profile_id,
            "privateKey": args.private_key,
            "apiBase": args.api_base or DEFAULT_API_BASE,
            "botToken": result["botToken"],
            "tokenExpiresAt": result["expiresAt"],
        }
        save_credentials(args.save, creds)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print("Authentication successful!")
        print(f"  Token:   {result['botToken'][:20]}...")
        print(f"  Expires: {result['expiresAt']}")
        print(f"  Scopes:  {', '.join(result.get('scopes', []))}")
        if args.save:
            print(f"  Saved:   {args.save}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
