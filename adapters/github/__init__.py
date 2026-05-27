"""GitHub adapter — branches, PRs, and the event-gated merge (ADR-0016)."""

from adapters.github.adapter import GitHubAdapter, GitHubClient, MergeRefused

__all__ = ["GitHubAdapter", "GitHubClient", "MergeRefused"]
