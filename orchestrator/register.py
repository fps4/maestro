"""The product register, loaded read-only into the operational store at boot (ADR-0008/0010).

The canonical register is ``config/products.yaml`` — git-tracked config-as-code, kept private
(ADR-0010), so changing it *is* a reviewed PR. It is **never** authoritative inside the running store:
it is a read-only projection here, used to resolve gate assignees and per-product role membership.

Each product declares its ``product_type``, repos, and participant roster (handle + role + per-surface
identity). The roster is the source of truth for "who holds a role for this product" (ADR-0005/0008) —
which is exactly what the merge boundary checks (ADR-0016).
"""
import os
import pathlib
from dataclasses import dataclass, field
from typing import Optional

import yaml

DEFAULT_REGISTER = "config/products.yaml"
EXAMPLE_REGISTER = "config/products.example.yaml"


@dataclass(frozen=True)
class Participant:
    handle: str
    role: str
    slack_user_id: Optional[str] = None
    telegram_user_id: Optional[str] = None

    def matches(self, identity: str) -> bool:
        """True if ``identity`` names this participant — by handle or any per-surface id (ADR-0011).

        Attribution can arrive as a workspace/Slack/Telegram identity, so all are accepted.
        """
        return identity is not None and identity in {
            self.handle, self.slack_user_id, self.telegram_user_id,
        } - {None}


@dataclass(frozen=True)
class Product:
    id: str
    name: str
    product_type: str
    visibility: str
    repos: tuple[str, ...] = ()
    participants: tuple[Participant, ...] = ()

    def role_holders(self, role: str) -> list[Participant]:
        return [p for p in self.participants if p.role == role]

    def has_repo(self, full_name: str) -> bool:
        return full_name in self.repos


@dataclass
class Register:
    products: dict[str, Product] = field(default_factory=dict)

    def product(self, product_id: str) -> Optional[Product]:
        return self.products.get(product_id)

    def product_for_repo(self, full_name: str) -> Optional[Product]:
        for p in self.products.values():
            if p.has_repo(full_name):
                return p
        return None


def load_register(path: Optional[str] = None, *, allow_example: bool = False) -> Register:
    """Load the register. Resolution order: explicit ``path`` → ``PRODUCTS_REGISTER`` env →
    ``config/products.yaml``. If that private file is absent and ``allow_example`` is set (tests/dev),
    fall back to the public ``config/products.example.yaml``.
    """
    chosen = path or os.environ.get("PRODUCTS_REGISTER", DEFAULT_REGISTER)
    p = pathlib.Path(chosen)
    if not p.exists() and allow_example and pathlib.Path(EXAMPLE_REGISTER).exists():
        p = pathlib.Path(EXAMPLE_REGISTER)
    if not p.exists():
        raise FileNotFoundError(
            f"product register not found at {chosen!r}; copy config/products.example.yaml to "
            f"config/products.yaml (it is gitignored — ADR-0010)"
        )
    data = yaml.safe_load(p.read_text()) or {}
    products: dict[str, Product] = {}
    for raw in data.get("products", []):
        parts = tuple(
            Participant(
                handle=pp.get("handle"),
                role=pp.get("role"),
                slack_user_id=pp.get("slack_user_id"),
                telegram_user_id=str(pp["telegram_user_id"]) if pp.get("telegram_user_id") else None,
            )
            for pp in raw.get("participants", [])
        )
        prod = Product(
            id=raw["id"],
            name=raw.get("name", raw["id"]),
            product_type=raw.get("product_type", "technical"),
            visibility=raw.get("visibility", "private"),
            repos=tuple(raw.get("repos", [])),
            participants=parts,
        )
        products[prod.id] = prod
    return Register(products=products)
