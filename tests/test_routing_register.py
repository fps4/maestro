"""Routing resolution (ADR-0003) + the register projection (ADR-0008/0010)."""
import textwrap

import pytest

from orchestrator.register import (
    Participant,
    Product,
    RegisterError,
    load_register,
)


def test_technical_merge_gate_routes_to_architect(routing, register):
    product = register.product("maestro")
    assert routing.role_for(product.product_type, "technical_merge") == "architect"
    deciders = routing.eligible_deciders(product, "technical_merge")
    assert [p.handle for p in deciders] == ["@arch"]


def test_commercial_functional_gate_routes_to_functional_reviewer(routing):
    assert routing.role_for("commercial", "functional") == "functional_reviewer"
    assert routing.role_for("technical", "functional") == "architect"


def test_missing_product_type_defaults_to_technical(routing):
    # Unknown/blank product_type → architect reviews everything (orchestrator failure mode).
    assert routing.role_for(None, "technical_merge") == "architect"
    assert routing.role_for("nonsense", "functional") == "architect"


def test_participant_matches_by_handle_or_surface_id():
    p = Participant(handle="@arch", role="architect", slack_user_id="U_ARCH")
    assert p.matches("@arch")
    assert p.matches("U_ARCH")
    assert not p.matches("@someone-else")
    assert not p.matches(None)


def test_example_register_loads_and_resolves_repos():
    # Target the public template explicitly — a local private config/products.yaml may also exist.
    reg = load_register("config/products.example.yaml")
    maestro = reg.product("maestro")
    assert maestro is not None
    assert maestro.product_type == "technical"
    assert reg.product_for_repo("your-org/maestro") is maestro
    acme = reg.product("acme-billing")
    assert acme.product_type == "commercial"
    assert [p.handle for p in acme.role_holders("functional_reviewer")] == ["@priya", "@sam"]


# --- US-0024 H6: architect self-deal invariant on commercial products ---------------------------

def _write_register(tmp_path, body: str):
    p = tmp_path / "products.yaml"
    p.write_text(textwrap.dedent(body))
    return str(p)


def test_self_dealing_handles_detects_one_human_in_both_roles():
    prod = Product(
        id="acme", name="Acme", product_type="commercial", visibility="private",
        repos=("acme/api",),
        participants=(
            Participant(handle="@you", role="architect", email="you@example.com"),
            Participant(handle="@you", role="functional_reviewer", email="you@example.com"),
            Participant(handle="@priya", role="functional_reviewer"),
        ),
    )
    assert prod.self_dealing_handles() == ["@you"]


def test_commercial_product_with_self_dealing_architect_refuses_to_load(tmp_path):
    path = _write_register(tmp_path, """
        version: 1
        products:
          - id: acme
            name: Acme
            product_type: commercial
            repos: [acme/api]
            participants:
              - { handle: "@you", role: architect, email: you@example.com }
              - { handle: "@you", role: functional_reviewer, email: you@example.com }
    """)
    with pytest.raises(RegisterError) as ei:
        load_register(path)
    msg = str(ei.value)
    assert "@you" in msg and "commercial" in msg and "ADR-0003" in msg


def test_commercial_product_with_separated_roles_loads(tmp_path):
    path = _write_register(tmp_path, """
        version: 1
        products:
          - id: acme
            name: Acme
            product_type: commercial
            repos: [acme/api]
            participants:
              - { handle: "@you",   role: architect,           email: you@example.com }
              - { handle: "@priya", role: functional_reviewer, email: priya@example.com }
    """)
    reg = load_register(path)
    assert reg.product("acme") is not None


def test_technical_product_is_exempt_from_role_separation(tmp_path):
    # On a technical product the architect is the only reviewer by design — holding both roles is
    # not a governance break, so the loader must NOT refuse it.
    path = _write_register(tmp_path, """
        version: 1
        products:
          - id: solo
            name: Solo
            product_type: technical
            repos: [solo/api]
            participants:
              - { handle: "@you", role: architect,           email: you@example.com }
              - { handle: "@you", role: functional_reviewer, email: you@example.com }
    """)
    reg = load_register(path)
    assert reg.product("solo") is not None
