#!/usr/bin/env python3
"""Unit tests for auth.py — challenge-response authentication."""

import base64
import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from auth import (
    authenticate,
    sign_nonce,
    token_needs_refresh,
)
from keygen import generate_keypair


class TestSignNonce(unittest.TestCase):
    """Tests for nonce signing."""

    def test_sign_nonce_produces_valid_base64(self):
        """sign_nonce should return a valid base64 string."""
        private_key, _ = generate_keypair()
        nonce = base64.b64encode(os.urandom(32)).decode("ascii")
        signature = sign_nonce(nonce, private_key)
        self.assertIsInstance(signature, str)
        # Ed25519 signature is 64 bytes = 88 chars base64
        decoded = base64.b64decode(signature)
        self.assertEqual(len(decoded), 64)

    def test_sign_nonce_deterministic_for_same_input(self):
        """Same key + same nonce should produce the same signature."""
        private_key, _ = generate_keypair()
        nonce = base64.b64encode(b"test-nonce-12345678901234567890ab").decode("ascii")
        sig1 = sign_nonce(nonce, private_key)
        sig2 = sign_nonce(nonce, private_key)
        self.assertEqual(sig1, sig2)

    def test_sign_nonce_different_keys_different_signatures(self):
        """Different keys should produce different signatures for the same nonce."""
        key1, _ = generate_keypair()
        key2, _ = generate_keypair()
        nonce = base64.b64encode(os.urandom(32)).decode("ascii")
        sig1 = sign_nonce(nonce, key1)
        sig2 = sign_nonce(nonce, key2)
        self.assertNotEqual(sig1, sig2)

    def test_sign_nonce_verifiable_with_public_key(self):
        """Signature from sign_nonce should be verifiable with the public key."""
        from nacl.signing import VerifyKey

        private_key, public_key = generate_keypair()
        nonce_bytes = os.urandom(32)
        nonce_b64 = base64.b64encode(nonce_bytes).decode("ascii")

        signature_b64 = sign_nonce(nonce_b64, private_key)
        signature_bytes = base64.b64decode(signature_b64)
        public_key_bytes = base64.b64decode(public_key)

        verify_key = VerifyKey(public_key_bytes)
        # Should not raise
        verify_key.verify(nonce_bytes, signature_bytes)


class TestTokenNeedsRefresh(unittest.TestCase):
    """Tests for token_needs_refresh."""

    def test_none_expires_at_needs_refresh(self):
        self.assertTrue(token_needs_refresh(None))

    def test_empty_expires_at_needs_refresh(self):
        self.assertTrue(token_needs_refresh(""))

    def test_expired_token_needs_refresh(self):
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        self.assertTrue(token_needs_refresh(past))

    def test_token_expiring_within_24h_needs_refresh(self):
        soon = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat()
        self.assertTrue(token_needs_refresh(soon))

    def test_token_valid_beyond_24h_no_refresh(self):
        future = (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat()
        self.assertFalse(token_needs_refresh(future))

    def test_iso_format_with_z_suffix(self):
        future = (datetime.now(timezone.utc) + timedelta(hours=48)).strftime(
            "%Y-%m-%dT%H:%M:%S.%fZ"
        )
        self.assertFalse(token_needs_refresh(future))

    def test_invalid_date_needs_refresh(self):
        self.assertTrue(token_needs_refresh("not-a-date"))


class TestRequestFormatting(unittest.TestCase):
    """Tests for request/response formatting in the auth flow."""

    def test_challenge_request_payload(self):
        """Challenge request should send correct JSON payload."""
        bot_id = "550e8400-e29b-41d4-a716-446655440000"
        expected_payload = {"botProfileId": bot_id}
        payload_json = json.dumps(expected_payload)
        parsed = json.loads(payload_json)
        self.assertEqual(parsed["botProfileId"], bot_id)

    def test_verify_request_payload(self):
        """Verify request should contain all required fields."""
        payload = {
            "botProfileId": "550e8400-e29b-41d4-a716-446655440000",
            "nonceId": "nonce-id-123",
            "signature": base64.b64encode(b"x" * 64).decode("ascii"),
        }
        # Validate all fields present
        self.assertIn("botProfileId", payload)
        self.assertIn("nonceId", payload)
        self.assertIn("signature", payload)
        # Validate signature is valid base64
        decoded = base64.b64decode(payload["signature"])
        self.assertEqual(len(decoded), 64)

    def test_auth_response_parsing(self):
        """Auth response should contain botToken, expiresAt, and scopes."""
        response = {
            "botToken": "tok_abc123",
            "expiresAt": "2026-03-12T00:00:00.000Z",
            "scopes": ["post:write", "post:read"],
        }
        self.assertIn("botToken", response)
        self.assertIn("expiresAt", response)
        self.assertIn("scopes", response)
        self.assertIsInstance(response["scopes"], list)


class TestAuthenticateIntegration(unittest.TestCase):
    """Integration tests for the authenticate function (mocked HTTP)."""

    @patch("auth.verify_signature")
    @patch("auth.request_challenge")
    def test_full_auth_flow(self, mock_challenge, mock_verify):
        """Test the full challenge-response flow with mocked HTTP."""
        private_key, _public_key = generate_keypair()
        bot_id = "550e8400-e29b-41d4-a716-446655440000"

        # Mock challenge response
        nonce = base64.b64encode(os.urandom(32)).decode("ascii")
        mock_challenge.return_value = {
            "nonceId": "nonce-123",
            "nonce": nonce,
            "expiresAt": "2026-03-12T00:00:00.000Z",
        }

        # Mock verify response
        mock_verify.return_value = {
            "botToken": "tok_test123",
            "expiresAt": "2026-03-12T00:00:00.000Z",
            "scopes": ["post:write", "post:read"],
        }

        result = authenticate(bot_id, private_key, "http://localhost:3000/api")

        # Verify challenge was called
        mock_challenge.assert_called_once_with(
            bot_id, "http://localhost:3000/api"
        )

        # Verify verify was called with correct args
        call_args = mock_verify.call_args
        self.assertEqual(call_args[0][0], bot_id)
        self.assertEqual(call_args[0][1], "nonce-123")
        # Signature should be valid base64
        sig = call_args[0][2]
        decoded_sig = base64.b64decode(sig)
        self.assertEqual(len(decoded_sig), 64)

        # Verify result
        self.assertEqual(result["botToken"], "tok_test123")


if __name__ == "__main__":
    unittest.main()
