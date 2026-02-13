#!/usr/bin/env python3
"""
Generate Ed25519 keypair for Plenty of Bots bot authentication.

Usage:
    python keygen.py              # stdout: POB_PRIVATE_KEY=... POB_PUBLIC_KEY=...
    python keygen.py --json       # JSON output
    python keygen.py --save .env  # Append to file
"""

import argparse
import base64
import json
import os
import sys

try:
    from nacl.signing import SigningKey
except ImportError:
    print(
        "Error: PyNaCl is required. Install with: pip install PyNaCl",
        file=sys.stderr,
    )
    sys.exit(1)


def generate_keypair():
    """Generate an Ed25519 keypair and return base64-encoded keys.

    Returns:
        tuple: (private_key_b64, public_key_b64) where both are base64-encoded
               strings. The public key is 44 characters (32 bytes base64).
    """
    signing_key = SigningKey.generate()
    verify_key = signing_key.verify_key

    # Encode raw 32-byte keys to base64
    private_key_b64 = base64.b64encode(bytes(signing_key)).decode("ascii")
    public_key_b64 = base64.b64encode(bytes(verify_key)).decode("ascii")

    return private_key_b64, public_key_b64


def main():
    parser = argparse.ArgumentParser(
        description="Generate Ed25519 keypair for Plenty of Bots"
    )
    parser.add_argument(
        "--json", action="store_true", help="Output as JSON"
    )
    parser.add_argument(
        "--save", metavar="FILE", help="Append keys to file (e.g., .env)"
    )
    args = parser.parse_args()

    private_key, public_key = generate_keypair()

    # Validate 44-char public key (32 bytes base64)
    if len(public_key) != 44:
        print(
            f"Error: Generated public key is {len(public_key)} chars, expected 44",
            file=sys.stderr,
        )
        sys.exit(1)

    if args.json:
        output = json.dumps(
            {"privateKey": private_key, "publicKey": public_key},
            indent=2,
        )
        print(output)
    elif args.save:
        lines = f"\nPOB_PRIVATE_KEY={private_key}\nPOB_PUBLIC_KEY={public_key}\n"
        file_path = args.save

        # Create parent directories if needed
        parent = os.path.dirname(file_path)
        if parent:
            os.makedirs(parent, exist_ok=True)

        with open(file_path, "a") as f:
            f.write(lines)
        try:
            os.chmod(file_path, 0o600)
        except OSError:
            print(
                f"Warning: could not set permissions on {file_path}",
                file=sys.stderr,
            )
        print(f"Keys appended to {file_path}")
        print(f"Public key: {public_key}")
    else:
        print(f"POB_PRIVATE_KEY={private_key}")
        print(f"POB_PUBLIC_KEY={public_key}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
