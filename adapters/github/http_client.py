"""A real :class:`~adapters.github.adapter.GitHubClient` over the GitHub REST API, using only the
stdlib (``urllib``) so the engine spine pulls in no HTTP dependency.

Auth is a fine-grained PAT (or App token) scoped to branch-create + PR-open + **merge** (ADR-0016) —
the token is read from the environment, never source (standards/security.yaml). This client is pure
I/O: all merge *authorization* lives in the adapter's guard, never here.
"""
import base64
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

API_BASE = "https://api.github.com"


class GitHubError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(f"GitHub API {status}: {message}")


class HttpGitHubClient:
    def __init__(self, token: Optional[str] = None, api_base: str = API_BASE):
        # Token optional: the read-only content path (ADR-0018) works unauthenticated against PUBLIC
        # repos (rate-limited). The write paths (branch/PR/merge) always need a scoped token.
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

    def open_pull_request(self, repo: str, head: str, base: str, title: str, body: str,
                          draft: bool = False) -> dict:
        pr = self._request("POST", f"/repos/{repo}/pulls",
                          {"title": title, "head": head, "base": base, "body": body,
                           "draft": draft})
        return {"number": pr["number"], "url": pr["html_url"], "draft": pr.get("draft", draft)}

    def merge_pull_request(self, repo: str, number: int, method: str) -> dict:
        res = self._request("PUT", f"/repos/{repo}/pulls/{number}/merge",
                          {"merge_method": method})
        return {"merged": res.get("merged", False), "sha": res.get("sha")}

    def put_file(self, repo: str, path: str, content: str, branch: str, message: str,
                 sha: Optional[str] = None) -> dict:
        """Create or update one file on a branch — ``PUT /repos/{repo}/contents/{path}``.

        Required when ``path`` already exists on ``branch``: pass ``sha`` (the file's blob SHA, from
        :meth:`get_contents`). GitHub rejects the call otherwise — a deliberate optimistic-concurrency
        check we surface as :class:`GitHubError` 409/422 rather than papering over.

        Returns ``{commit_sha, file_sha, path}``. The **branch policy** (``maestro/*`` only) is
        enforced *one layer up*, in :meth:`adapters.github.adapter.GitHubAdapter.commit_artefact`;
        this client is pure I/O (same shape as ``merge_pull_request``).
        """
        q = urllib.parse.quote(path)
        body = {
            "message": message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "branch": branch,
        }
        if sha is not None:
            body["sha"] = sha
        res = self._request("PUT", f"/repos/{repo}/contents/{q}", body)
        commit = res.get("commit") or {}
        content_meta = res.get("content") or {}
        return {"commit_sha": commit.get("sha", ""),
                "file_sha": content_meta.get("sha", ""),
                "path": path}

    def commit_files(self, repo: str, branch: str, files: list[dict], message: str) -> dict:
        """Commit **many files in one commit** on ``branch`` via the Git Data API (US-0011).

        The Contents API (:meth:`put_file`) commits one file at a time; the builder needs a task's
        files to land as a single commit (M2 one-commit-per-task resolution). The sequence is the
        standard low-level git plumbing: read the branch tip → build a new tree on top of the tip's
        tree → create a commit pointing at it → fast-forward the branch ref.

        ``files`` is a list of ``{"path", "content"}``. The **branch policy** (``maestro/*`` only)
        is enforced one layer up in :meth:`adapters.github.adapter.GitHubAdapter.commit_change`;
        this client is pure I/O (same shape as :meth:`put_file`). Returns ``{commit_sha}``.
        """
        base_sha = self.head_sha(repo, branch)
        base_commit = self._request("GET", f"/repos/{repo}/git/commits/{base_sha}")
        base_tree = base_commit["tree"]["sha"]
        tree = self._request("POST", f"/repos/{repo}/git/trees", {
            "base_tree": base_tree,
            "tree": [{"path": f["path"], "mode": "100644", "type": "blob",
                      "content": f["content"]} for f in files],
        })
        commit = self._request("POST", f"/repos/{repo}/git/commits", {
            "message": message, "tree": tree["sha"], "parents": [base_sha],
        })
        self._request("PATCH", f"/repos/{repo}/git/refs/heads/{urllib.parse.quote(branch)}",
                      {"sha": commit["sha"], "force": False})
        return {"commit_sha": commit["sha"]}

    # --- RepoContentReader (read-only; the workspace read API, ADR-0017/0018) --------------------
    # Read of repo content as-committed. The merge boundary above is unchanged: there is still no
    # write path into a default branch here — these are GET-only.

    def head_sha(self, repo: str, ref: str) -> str:
        """The commit SHA at the tip of branch ``ref`` — the index cache key (one cheap call)."""
        head = self._request("GET", f"/repos/{repo}/git/ref/heads/{urllib.parse.quote(ref)}")
        return head["object"]["sha"]

    def get_contents(self, repo: str, path: str, ref: str) -> dict:
        """Return ``{content, sha, path}`` for one file as-committed on ``ref`` (branch/sha)."""
        q = urllib.parse.quote(path)
        res = self._request("GET", f"/repos/{repo}/contents/{q}?ref={urllib.parse.quote(ref)}")
        content = res.get("content", "")
        if res.get("encoding") == "base64":
            content = base64.b64decode(content).decode("utf-8", errors="replace")
        return {"content": content, "sha": res.get("sha", ""), "path": path}

    def list_tree_entries(self, repo: str, ref: str, path_prefix: str = "") -> list[tuple[str, str]]:
        """List ``(path, blob_sha)`` under ``path_prefix`` at ``ref`` — one recursive trees call.

        The blob SHA is the file's content hash: it lets the index skip re-fetching unchanged files
        (ADR-0018). Returns the tip's tree.
        """
        sha = self.head_sha(repo, ref)
        tree = self._request("GET", f"/repos/{repo}/git/trees/{sha}?recursive=1")
        return [(t["path"], t["sha"]) for t in tree.get("tree", [])
                if t.get("type") == "blob" and t["path"].startswith(path_prefix)]

    # --- transport ------------------------------------------------------------------------------

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self._api_base}{path}", data=data, method=method)
        if self._token:
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
