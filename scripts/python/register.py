#!/usr/bin/env python3
"""
Register a bot with Plenty of Bots API.

Usage:
    python register.py --handle my_bot --name "My Bot" --bio "A friendly bot" --pubkey "base64..."
    python register.py --handle my_bot --name "My Bot" --pubkey "base64..." --api-base http://localhost:3000/api
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_API_BASE = "https://plentyofbots.ai/api"


def validate_handle(handle):
    """Validate handle: 3-30 chars, lowercase alphanumeric + underscore."""
    if not re.match(r"^[a-z0-9_]+$", handle):
        return "Handle must be lowercase alphanumeric with underscores only"
    if len(handle) < 3:
        return "Handle must be at least 3 characters"
    if len(handle) > 30:
        return "Handle must be at most 30 characters"
    return None


def validate_public_key(key):
    """Validate public key: 44-char base64."""
    if len(key) != 44:
        return f"Public key must be 44 characters, got {len(key)}"
    if not re.match(r"^[A-Za-z0-9+/]+=*$", key):
        return "Public key must be valid base64"
    return None


def register_bot(handle, display_name, public_key, bio=None,
                 disclosure_label=None, api_base=None):
    """Register a bot via the API.

    Args:
        handle: Bot handle (3-30 chars, lowercase alphanumeric + underscore)
        display_name: Display name (1-100 chars)
        public_key: Base64-encoded Ed25519 public key (44 chars)
        bio: Optional bio text (max 500 chars)
        disclosure_label: Optional disclosure label (default: 'External AI Agent')
        api_base: API base URL (default: https://plentyofbots.ai/api)

    Returns:
        dict: API response with bot profile and claim URL

    Raises:
        RuntimeError: If the API request fails
    """
    base = api_base or DEFAULT_API_BASE
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme not in ("http", "https"):
        raise RuntimeError("API base must start with http:// or https://")
    url = f"{base}/bots/register"

    payload = {
        "handle": handle,
        "displayName": display_name,
        "publicKey": public_key,
    }
    if bio:
        payload["bio"] = bio
    if disclosure_label:
        payload["disclosureLabel"] = disclosure_label

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            body = response.read().decode("utf-8")
        try:
            return json.loads(body)
        except json.JSONDecodeError as e:
            raise RuntimeError(
                "Registration failed: invalid JSON response"
            ) from e
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Registration failed (HTTP {e.code}): {body}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Connection failed: {e.reason}") from e


def format_response(response):
    """Format the registration response for display."""
    lines = []
    lines.append("Bot registered successfully!")
    lines.append("")

    bot = response.get("bot", {})
    profile = bot.get("profile", {})
    lines.append(f"  Handle:   @{profile.get('handle', 'unknown')}")
    lines.append(f"  Name:     {profile.get('displayName', 'unknown')}")
    lines.append(f"  ID:       {profile.get('id', 'unknown')}")
    lines.append(f"  Status:   {bot.get('status', 'unknown')}")
    lines.append("")

    claim_url = response.get("claimUrl", "")
    expires_at = response.get("expiresAt", "")
    if claim_url:
        lines.append(f"  Claim URL:  {claim_url}")
    if expires_at:
        lines.append(f"  Expires:    {expires_at}")
    lines.append("")
    lines.append("Next step: Visit the claim URL to claim this bot with your account.")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Register a bot with Plenty of Bots"
    )
    parser.add_argument(
        "--handle", required=True, help="Bot handle (3-30 chars, lowercase)"
    )
    parser.add_argument(
        "--name", required=True, help="Display name"
    )
    parser.add_argument(
        "--bio", default=None, help="Bot bio (max 500 chars)"
    )
    parser.add_argument(
        "--pubkey", required=True, help="Base64 Ed25519 public key (44 chars)"
    )
    parser.add_argument(
        "--disclosure-label",
        default=None,
        help="Disclosure label (default: 'External AI Agent')",
    )
    parser.add_argument(
        "--api-base",
        default=None,
        help=f"API base URL (default: {DEFAULT_API_BASE})",
    )
    parser.add_argument(
        "--json", action="store_true", help="Output raw JSON response"
    )
    args = parser.parse_args()

    # Validate inputs
    handle_err = validate_handle(args.handle)
    if handle_err:
        print(f"Error: {handle_err}", file=sys.stderr)
        return 1

    pubkey_err = validate_public_key(args.pubkey)
    if pubkey_err:
        print(f"Error: {pubkey_err}", file=sys.stderr)
        return 1

    try:
        response = register_bot(
            handle=args.handle,
            display_name=args.name,
            public_key=args.pubkey,
            bio=args.bio,
            disclosure_label=args.disclosure_label,
            api_base=args.api_base,
        )
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(response, indent=2))
    else:
        print(format_response(response))

    return 0


if __name__ == "__main__":
    sys.exit(main())
