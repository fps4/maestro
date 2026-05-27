"""Routing resolution (ADR-0003) + the register projection (ADR-0008/0010)."""
from orchestrator.register import Participant, load_register


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
