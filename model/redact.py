"""Minimal secret/PII redaction for persisted text (US-0024 M9, ADR-0009).

Redaction-before-persistence is an acceptance criterion (US-0022); the full tooling (e.g. Presidio)
is downstream engineering. This is the **M2 floor**: a small, dependency-free regex pass that masks
the highest-risk leaks — known secret token shapes and email addresses — applied where maestro
persists model I/O that could echo a credential (today: the ``error`` field of a failed
:class:`~model.audit.LLMCall`, which can quote provider request data).

It is deliberately conservative: it errs toward masking and never raises. It is **not** a complete
DLP solution — the M2 audit corpus stance is documented in
``docs/roadmap/m2-build-to-merge.md`` (do not paste live secrets into intent).
"""
import re

MASK = "[REDACTED]"
EMAIL_MASK = "[REDACTED_EMAIL]"

# Order matters: more specific token shapes first, generic assignments last, then email.
_PATTERNS: list[tuple[re.Pattern, str]] = [
    # PEM private-key blocks (whole block → one mask).
    (re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----.*?"
                r"-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----", re.DOTALL), MASK),
    # AWS access key id.
    (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), MASK),
    # GitHub tokens (classic + fine-grained + oauth/app).
    (re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b"), MASK),
    # Anthropic / OpenAI style keys.
    (re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b"), MASK),
    # Slack tokens.
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"), MASK),
    # Bearer tokens in an auth header echo.
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{12,}"), "bearer " + MASK),
    # Generic "secret/token/password/api_key = <value>" assignments (json or kv).
    (re.compile(r"(?i)(\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[=:]\s*)"
                r"['\"]?[A-Za-z0-9._\-]{6,}['\"]?"), r"\1" + MASK),
    # Email addresses (PII) — last, so it doesn't eat inside a masked token.
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), EMAIL_MASK),
]


def redact(text):
    """Return ``text`` with known secret shapes and emails masked. Non-strings pass through; never
    raises (redaction must not become a new failure mode on the persistence path)."""
    if not isinstance(text, str) or not text:
        return text
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    return text
