"""Minimal secret/PII redaction (US-0024 M9)."""
from model.redact import redact


def test_masks_known_secret_shapes():
    cases = [
        "AKIAIOSFODNN7EXAMPLE",                       # AWS access key id
        "ghp_0123456789abcdefghijABCDEFGHIJ012345",   # GitHub PAT
        "sk-ant-api03-abcDEF0123456789_-xyz",          # Anthropic key
        "xoxb-123456789012-abcdefghijkl",              # Slack token
    ]
    for secret in cases:
        out = redact(f"using {secret} now")
        assert secret not in out, secret
        assert "[REDACTED]" in out


def test_masks_assignments_and_bearer():
    assert "hunter2" not in redact('password: "hunter2"')
    assert "topsecretvalue" not in redact("api_key=topsecretvalue")
    assert redact("Authorization: Bearer abcdef123456789").count("[REDACTED]") == 1


def test_masks_email_as_pii():
    out = redact("contact priya@example.com please")
    assert "priya@example.com" not in out
    assert "[REDACTED_EMAIL]" in out


def test_masks_private_key_block():
    pem = ("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\nlots\n-----END RSA PRIVATE KEY-----")
    out = redact(f"key:\n{pem}\ntail")
    assert "MIIEowIBAAKCAQEA" not in out
    assert out.startswith("key:") and out.endswith("tail")


def test_passes_through_clean_text_and_non_strings():
    assert redact("just a normal sentence with no secrets") == "just a normal sentence with no secrets"
    assert redact(None) is None
    assert redact("") == ""
    assert redact(42) == 42
