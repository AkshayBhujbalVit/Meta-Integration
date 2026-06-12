"""
Security & encryption tests.
"""

from core.encryption import decrypt, encrypt, is_encrypted
from core.security import create_access_token, decode_token, hash_password, verify_password


class TestEncryption:
    def test_encrypt_returns_fernet_token(self):
        token = encrypt("my-api-key")
        assert token is not None
        assert is_encrypted(token)

    def test_decrypt_roundtrip(self):
        original = "sk-test-1234567890"  # pragma: allowlist secret
        assert decrypt(encrypt(original)) == original

    def test_decrypt_handles_plaintext_gracefully(self):
        # Migration path: old plaintext values must not crash
        assert decrypt("plain-text-value") == "plain-text-value"

    def test_encrypt_none_returns_none(self):
        assert encrypt(None) is None

    def test_decrypt_none_returns_none(self):
        assert decrypt(None) is None

    def test_different_inputs_produce_different_ciphertexts(self):
        # Fernet uses random IV — same input yields different tokens
        t1 = encrypt("same")
        t2 = encrypt("same")
        assert t1 != t2
        assert decrypt(t1) == decrypt(t2) == "same"


class TestPasswordHashing:
    def test_hash_is_not_plaintext(self):
        pw = "secret123"
        hashed = hash_password(pw)
        assert hashed != pw

    def test_verify_correct_password(self):
        pw = "correct-horse-battery-staple"
        assert verify_password(pw, hash_password(pw))

    def test_reject_wrong_password(self):
        assert not verify_password("wrong", hash_password("right"))


class TestJWT:
    def test_create_and_decode_token(self):
        token = create_access_token({"sub": "admin@example.com"})
        payload = decode_token(token)
        assert payload is not None
        assert payload["sub"] == "admin@example.com"

    def test_tampered_token_returns_none(self):
        token = create_access_token({"sub": "admin@example.com"})
        tampered = token[:-5] + "XXXXX"
        assert decode_token(tampered) is None
