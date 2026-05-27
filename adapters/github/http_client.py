"""A real :class:`~adapters.github.adapter.GitHubClient` over the GitHub REST API, using only the
stdlib (``urllib``) so the engine spine pulls in no HTTP dependency.

Auth is a fine-grained PAT (or App token) scoped to branch-create + PR-open + **merge** (ADR-0016) —
the token is read from the environment, never source (standards/security.yaml). This client is pure
I/O: all merge *authorization* lives in the adapter's guard, never here.
"""
import json
import urllib.error
import urllib.request
from typing import Any, Optional

API_BASE = "https://api.github.com"


class GitHubError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(f"GitHub API {status}: {message}")


class HttpGitHubClient:
    def __init__(self, token: str, api_base: str = API_BASE):
        self._token = token
        self._api_base = api_base.rstrip("/")

    # --- connection check (used at boot) --------------------------------------------------------

    def verify(self) -> str:
        """Return the authenticated login, or raise — used by the boot connection check (US-0001)."""
        return self._request("GET", "/user")["login"]

    # --- GitHubClient protocol ------------------------------------------------------------------

    def create_branch(self, repo: str, branch: str, from_ref: str) -> dict:
        base = self._request("GET", f"/repos/{repo}/git/ref/heads/{from_ref}")
        sha = base["object"]["sha"]
        return self._request("POST", f"/repos/{repo}/git/refs",
                             {"ref": f"refs/heads/{branch}", "sha": sha})

    def open_pull_request(self, repo: str, head: str, base: str, title: str, body: str) -> dict:
        pr = self._request("POST", f"/repos/{repo}/pulls",
                          {"title": title, "head": head, "base": base, "body": body})
        return {"number": pr["number"], "url": pr["html_url"]}

    def merge_pull_request(self, repo: str, number: int, method: str) -> dict:
        res = self._request("PUT", f"/repos/{repo}/pulls/{number}/merge",
                          {"merge_method": method})
        return {"merged": res.get("merged", False), "sha": res.get("sha")}

    # --- transport ------------------------------------------------------------------------------

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self._api_base}{path}", data=data, method=method)
        req.add_header("Authorization", f"Bearer {self._token}")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read() or "null")
        except urllib.error.HTTPError as exc:
            raise GitHubError(exc.code, exc.read().decode(errors="replace")) from None
