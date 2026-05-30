"""The HTTP binding for the workspace API — stdlib only, no web framework.

The github client pulls in no HTTP dependency (``http_client.py``); the API surface holds the line on
the server side too — :class:`http.server.ThreadingHTTPServer`, so the engine adds no framework dep.
The logic lives in :class:`~orchestrator.readapi.ReadAPI` (GETs, S1) and
:class:`~orchestrator.writeapi.WriteAPI` (POSTs, S2/S3 + M1 dispatch — workspace-write-api.md); this is
a thin adapter (route → call → JSON), so swapping in FastAPI later touches only this file.

One binding hosts both contracts so the operator has one process to run and the workspace one base URL
to talk to. The two APIs share identity resolution (ADR-0019), the error envelope, and the
404-not-403 isolation rule (ADR-0010/0011).

Identity (ADR-0019): the caller identity is taken from the ``X-Maestro-Identity`` header set by the auth
edge (Cloudflare Access → component-auth) — **never** trusted from the client otherwise. Locally, with
no edge, ``MAESTRO_DEV_IDENTITY`` supplies a stub so render + isolation can be built first; the stub is
**refused when ``MAESTRO_ENV=production``**. No identity → ``401``.

Dev-stub belt-and-braces (US-0024 H7, ADR-0019): the stub alone is not enough to be honoured. Even when
configured (non-production), it is granted **only** to a request that carries a Cloudflare Access JWT
(``Cf-Access-Jwt-Assertion``) *or* originates from loopback — so a bare URL-knower reaching the tunnel
without an Access assertion gets no identity and cannot dispatch tasks or approve merges as the stub.
The matching startup probe (``orchestrator.boot._check_dev_identity``) refuses to start at all unless
``MAESTRO_ENV=dev`` when the stub is set, so a stub left on in staging/production fails fast.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional
from urllib.parse import parse_qs, unquote, urlparse

from orchestrator.readapi import APIError, ReadAPI, Unauthenticated
from orchestrator.writeapi import WriteAPI

IDENTITY_HEADER = "X-Maestro-Identity"
ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion"   # Cloudflare Access assertion (ADR-0019 edge)
IDEMPOTENCY_HEADER = "Idempotency-Key"
IF_MATCH_HEADER = "If-Match"
MAX_REQUEST_BODY_BYTES = 64 * 1024            # writes are tiny JSON; reject anything mistaken

_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


class NotFoundRoute(APIError):
    code = "not_found"
    status = 404

    def __init__(self):
        super().__init__("no such route")


def _is_loopback(client_host: Optional[str]) -> bool:
    """True if the request came from the local host (pure-local dev, no edge). Factored out so a
    test can monkeypatch it to simulate the edge-deployment posture over a loopback socket."""
    return client_host in _LOOPBACK_HOSTS


def resolve_identity(headers, client_host: Optional[str] = None) -> str | None:
    """The authenticated caller, from the trusted edge header or the dev stub (ADR-0019).

    The edge header (set by Cloudflare Access → component-auth) is always honoured. The dev stub is
    honoured only off-production AND only when the request carries an Access JWT or comes from
    loopback (US-0024 H7) — otherwise ``None`` (the caller will get a 401).
    """
    edge = headers.get(IDENTITY_HEADER)
    if edge:
        return edge.strip()
    if os.environ.get("MAESTRO_ENV") == "production":
        return None
    stub = os.environ.get("MAESTRO_DEV_IDENTITY") or None
    if stub is None:
        return None
    if headers.get(ACCESS_JWT_HEADER) or _is_loopback(client_host):
        return stub
    return None


def make_handler(read: ReadAPI, write: Optional[WriteAPI] = None):
    """Build a request handler bound to ``read`` (S1) and optionally ``write`` (S2/S3 + M1 dispatch).

    ``write`` may be omitted when only the read surface is needed (e.g. the early M0 read-only slice
    and the existing tests). When omitted, ``POST`` requests return ``404 not_found``.
    """

    class Handler(BaseHTTPRequestHandler):
        server_version = "maestro-workspace-api/1"
        protocol_version = "HTTP/1.1"

        def do_GET(self):  # noqa: N802 (stdlib name)
            parsed = urlparse(self.path)
            parts = [unquote(p) for p in parsed.path.split("/") if p]
            qs = parse_qs(parsed.query)
            one = lambda k: (qs.get(k) or [None])[0]  # noqa: E731
            try:
                identity = resolve_identity(self.headers, self.client_address[0])
                if identity is None:
                    raise Unauthenticated("no caller identity")
                self._route_get(parts, one, identity)
            except APIError as err:
                self._error(err)
            except BrokenPipeError:
                pass
            except Exception as exc:  # never leak a stack trace to the wire
                self._send(500, {"error": {"code": "internal", "message": str(exc)}})

        def do_POST(self):  # noqa: N802 (stdlib name)
            if write is None:
                self._error(NotFoundRoute())
                return
            parsed = urlparse(self.path)
            parts = [unquote(p) for p in parsed.path.split("/") if p]
            try:
                body = self._read_json_body()
                identity = resolve_identity(self.headers, self.client_address[0])
                if identity is None:
                    raise Unauthenticated("no caller identity")
                idempotency_key = self.headers.get(IDEMPOTENCY_HEADER)
                if_match = self._parse_if_match(self.headers.get(IF_MATCH_HEADER))
                self._route_post(parts, body, identity, idempotency_key, if_match)
            except APIError as err:
                self._error(err)
            except BrokenPipeError:
                pass
            except Exception as exc:
                self._send(500, {"error": {"code": "internal", "message": str(exc)}})

        # --- routes ---------------------------------------------------------------------------------

        def _route_get(self, parts, one, identity):
            if parts == ["api", "products"]:
                self._send(200, read.list_products(identity))
            elif len(parts) == 4 and parts[:2] == ["api", "products"] and parts[3] == "specs":
                self._send(200, read.list_specs(identity, parts[2], branch=one("branch"),
                                                kind=one("kind"), feature=one("feature")))
            elif len(parts) == 6 and parts[:2] == ["api", "products"] and parts[3] == "specs":
                doc = read.get_spec(identity, parts[2], parts[4], parts[5],
                                     branch=one("branch"), commit=one("commit"))
                etag = f'"{doc["ref"]["commit"]}:{doc["ref"]["path"]}"'
                if self.headers.get("If-None-Match") == etag:
                    self._send(304, None)
                else:
                    self._send(200, doc, extra_headers={"ETag": etag})
            elif len(parts) == 5 and parts[:2] == ["api", "products"] and parts[3] == "tasks":
                self._send(200, read.get_task(identity, parts[2], parts[4]))
            else:
                raise NotFoundRoute()

        def _route_post(self, parts, body, identity, idempotency_key, if_match):
            # POST /api/products/{p}/tasks — dispatch a new delivery task (US-0010 Q2).
            if (len(parts) == 4 and parts[:2] == ["api", "products"] and parts[3] == "tasks"):
                result = write.dispatch_task(
                    identity, parts[2],
                    intent=body.get("intent", ""),
                    repo=body.get("repo"),
                    idempotency_key=idempotency_key,
                )
                self._send(201, result)
            # POST /api/products/{p}/tasks/{t}/comments — anchored comment (S2).
            elif (len(parts) == 6 and parts[:2] == ["api", "products"]
                  and parts[3] == "tasks" and parts[5] == "comments"):
                result = write.post_comment(
                    identity, parts[2], parts[4],
                    body=body.get("body", ""),
                    anchor=body.get("anchor"),
                    in_reply_to=body.get("in_reply_to"),
                    idempotency_key=idempotency_key,
                )
                self._send(201, result)
            # POST /api/products/{p}/tasks/{t}/gates/{g}/decisions — decide a gate (S3).
            elif (len(parts) == 8 and parts[:2] == ["api", "products"]
                  and parts[3] == "tasks" and parts[5] == "gates" and parts[7] == "decisions"):
                result = write.decide_gate(
                    identity, parts[2], parts[4], parts[6],
                    decision=body.get("decision", ""),
                    rationale=body.get("rationale"),
                    if_match=if_match,
                    idempotency_key=idempotency_key,
                )
                self._send(200, result)
            else:
                raise NotFoundRoute()

        # --- header parsers -------------------------------------------------------------------------

        @staticmethod
        def _parse_if_match(raw):
            """``If-Match`` carries the gate.seq (an integer) for decision writes. Strip optional
            surrounding quotes; ``None`` if absent. A non-integer value defers the 422 to the write
            API so the contract's error envelope handles it (vs. an opaque 400 here)."""
            if raw is None or raw == "":
                return None
            raw = raw.strip()
            if len(raw) >= 2 and raw[0] == raw[-1] == '"':
                raw = raw[1:-1]
            try:
                return int(raw)
            except (TypeError, ValueError):
                return raw

        # --- body parsing ---------------------------------------------------------------------------

        def _read_json_body(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            if length < 0:
                raise APIError("invalid Content-Length")
            if length > MAX_REQUEST_BODY_BYTES:
                err = APIError(f"request body exceeds {MAX_REQUEST_BODY_BYTES} bytes")
                err.code = "bad_request"
                err.status = 413
                raise err
            if length == 0:
                return {}
            raw = self.rfile.read(length)
            try:
                body = json.loads(raw)
            except json.JSONDecodeError as exc:
                err = APIError(f"invalid JSON: {exc}")
                err.code = "bad_request"
                err.status = 400
                raise err
            if not isinstance(body, dict):
                err = APIError("request body must be a JSON object")
                err.code = "bad_request"
                err.status = 400
                raise err
            return body

        # --- response helpers -----------------------------------------------------------------------

        def _error(self, err: APIError):
            body = {"error": {"code": err.code, "message": err.message}}
            if err.ref:
                body["error"]["ref"] = err.ref
            self._send(err.status, body)

        def _send(self, status: int, body, extra_headers: dict | None = None):
            # default=str: frontmatter is arbitrary YAML — dates (e.g. `last_updated: 2026-05-27`) parse
            # to datetime.date, which json can't serialize. Render them as their ISO string form.
            payload = b"" if body is None else json.dumps(body, default=str).encode("utf-8")
            self.send_response(status)
            if body is not None:
                self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            for k, v in (extra_headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if payload:
                self.wfile.write(payload)

        def log_message(self, *args):  # keep test output clean; real logging is a later slice
            pass

    return Handler


def make_server(read: ReadAPI, write: Optional[WriteAPI] = None,
                host: str = "127.0.0.1", port: int = 8800) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), make_handler(read, write))


def serve(read: ReadAPI, write: Optional[WriteAPI] = None,
          host: str = "127.0.0.1", port: int = 8800) -> None:
    server = make_server(read, write, host, port)
    surface = "read+write" if write is not None else "read-only"
    print(f"workspace {surface} API on http://{host}:{server.server_address[1]}  (Ctrl-C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
