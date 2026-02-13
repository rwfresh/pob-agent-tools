#!/usr/bin/env python3
"""Unit tests for keygen.py — Ed25519 key generation."""

import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from keygen import generate_keypair


class TestGenerateKeypair(unittest.TestCase):
    """Tests for the generate_keypair function."""

    def test_returns_tuple_of_two_strings(self):
        private_key, public_key = generate_keypair()
        self.assertIsInstance(private_key, str)
        self.assertIsInstance(public_key, str)

    def test_public_key_is_44_chars(self):
        """Public key must be exactly 44 characters (32 bytes base64)."""
        _, public_key = generate_keypair()
        self.assertEqual(len(public_key), 44)

    def test_private_key_is_44_chars(self):
        """Private key must be exactly 44 characters (32 bytes base64)."""
        private_key, _ = generate_keypair()
        self.assertEqual(len(private_key), 44)

    def test_keys_are_valid_base64(self):
        """Both keys must be valid base64."""
        private_key, public_key = generate_keypair()
        base64_pattern = re.compile(r"^[A-Za-z0-9+/]+=*$")
        self.assertRegex(private_key, base64_pattern)
        self.assertRegex(public_key, base64_pattern)

    def test_keys_decode_to_32_bytes(self):
        """Both keys must decode to exactly 32 bytes."""
        private_key, public_key = generate_keypair()
        self.assertEqual(len(base64.b64decode(private_key)), 32)
        self.assertEqual(len(base64.b64decode(public_key)), 32)

    def test_unique_keypairs(self):
        """Each call should generate a unique keypair."""
        pair1 = generate_keypair()
        pair2 = generate_keypair()
        self.assertNotEqual(pair1[0], pair2[0])
        self.assertNotEqual(pair1[1], pair2[1])

    def test_signing_and_verification(self):
        """Generated keys should work for signing and verification."""
        from nacl.signing import SigningKey, VerifyKey

        private_key_b64, public_key_b64 = generate_keypair()
        private_key_bytes = base64.b64decode(private_key_b64)
        public_key_bytes = base64.b64decode(public_key_b64)

        signing_key = SigningKey(private_key_bytes)
        verify_key = VerifyKey(public_key_bytes)

        message = b"test message"
        signed = signing_key.sign(message)
        # This should not raise
        verify_key.verify(signed.message, signed.signature)


class TestKeygenCLI(unittest.TestCase):
    """Tests for the keygen.py CLI interface."""

    def _run_keygen(self, *args):
        """Run keygen.py as a subprocess and return output."""
        script = os.path.join(os.path.dirname(__file__), "keygen.py")
        result = subprocess.run(
            [sys.executable, script, *args],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result

    def test_default_output_format(self):
        """Default output should be POB_PRIVATE_KEY=... POB_PUBLIC_KEY=..."""
        result = self._run_keygen()
        self.assertEqual(result.returncode, 0)
        lines = result.stdout.strip().split("\n")
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("POB_PRIVATE_KEY="))
        self.assertTrue(lines[1].startswith("POB_PUBLIC_KEY="))

        # Verify public key is 44 chars
        pubkey = lines[1].split("=", 1)[1]
        self.assertEqual(len(pubkey), 44)

    def test_json_output(self):
        """--json should output valid JSON with privateKey and publicKey."""
        result = self._run_keygen("--json")
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertIn("privateKey", data)
        self.assertIn("publicKey", data)
        self.assertEqual(len(data["publicKey"]), 44)

    def test_save_to_file(self):
        """--save should append keys to the specified file."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".env",
                                         delete=False) as f:
            f.write("EXISTING=value\n")
            temp_path = f.name

        try:
            result = self._run_keygen("--save", temp_path)
            self.assertEqual(result.returncode, 0)

            with open(temp_path) as f:
                content = f.read()

            self.assertIn("EXISTING=value", content)
            self.assertIn("POB_PRIVATE_KEY=", content)
            self.assertIn("POB_PUBLIC_KEY=", content)
        finally:
            os.unlink(temp_path)


if __name__ == "__main__":
    unittest.main()
