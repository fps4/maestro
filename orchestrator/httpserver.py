"""The HTTP binding for the workspace read API — stdlib only, no web framework.

The github client pulls in no HTTP dependency (``http_client.py``); the read surface holds the line on
the server side too — :class:`http.server.ThreadingHTTPServer`, so the engine adds no framework dep. The
logic lives in :class:`~orchestrator.readapi.ReadAPI`; this is a thin adapter (route → call → JSON), so
swapping in FastAPI later (the contract's "likely" choice) touches only this file.

Identity (ADR-0019): the caller identity is taken from the ``X-Maestro-Identity`` header set by the auth
edge (Cloudflare Access → component-auth) — **never** trusted from the client otherwise. Locally, with
no edge, ``MAESTRO_DEV_IDENTITY`` supplies a stub so render + isolation can be built first; the stub is
**refused when ``MAESTRO_ENV=production``**. No identity → ``401``.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from orchestrator.readapi import APIError, ReadAPI, Unauthenticated

IDENTITY_HEADER = "X-Maestro-Identity"


class NotFoundRoute(APIError):
    code = "not_found"
    status = 404

    def __init__(self):
        super().__init__("no such route")


def resolve_identity(headers) -> str | None:
    """The authenticated caller, from the trusted edge header or the dev stub (ADR-0019)."""
    edge = headers.get(IDENTITY_HEADER)
    if edge:
        return edge.strip()
    if os.environ.get("MAESTRO_ENV") != "production":
        return os.environ.get("MAESTRO_DEV_IDENTITY") or None
    return None


def make_handler(api: ReadAPI):
    """Build a request handler bound to ``api`` (so the handler stays construction-free)."""

    class Handler(BaseHTTPRequestHandler):
        server_version = "maestro-readapi/1"
        protocol_version = "HTTP/1.1"

        def do_GET(self):  # noqa: N802 (stdlib name)
            parsed = urlparse(self.path)
            parts = [unquote(p) for p in parsed.path.split("/") if p]
            qs = parse_qs(parsed.query)
            one = lambda k: (qs.get(k) or [None])[0]  # noqa: E731
            try:
                identity = resolve_identity(self.headers)
                if identity is None:
                    raise Unauthenticated("no caller identity")
                self._route(parts, one, identity)
            except APIError as err:
                self._error(err)
            except BrokenPipeError:
                pass
            except Exception as exc:  # never leak a stack trace to the wire
                self._send(500, {"error": {"code": "internal", "message": str(exc)}})

        def _route(self, parts, one, identity):
            if parts == ["api", "products"]:
                self._send(200, api.list_products(identity))
            elif len(parts) == 4 and parts[:2] == ["api", "products"] and parts[3] == "specs":
                self._send(200, api.list_specs(identity, parts[2], branch=one("branch"),
                                               kind=one("kind"), feature=one("feature")))
            elif len(parts) == 6 and parts[:2] == ["api", "products"] and parts[3] == "specs":
                doc = api.get_spec(identity, parts[2], parts[4], parts[5], branch=one("branch"))
                etag = f'"{doc["ref"]["commit"]}:{doc["ref"]["path"]}"'
                if self.headers.get("If-None-Match") == etag:
                    self._send(304, None)
                else:
                    self._send(200, doc, extra_headers={"ETag": etag})
            else:
                raise NotFoundRoute()

        def _error(self, err: APIError):
            body = {"error": {"code": err.code, "message": err.message}}
            if err.ref:
                body["error"]["ref"] = err.ref
            self._send(err.status, body)

        def _send(self, status: int, body, extra_headers: dict | None = None):
            payload = b"" if body is None else json.dumps(body).encode("utf-8")
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


def make_server(api: ReadAPI, host: str = "127.0.0.1", port: int = 8800) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), make_handler(api))


def serve(api: ReadAPI, host: str = "127.0.0.1", port: int = 8800) -> None:
    server = make_server(api, host, port)
    print(f"workspace read API on http://{host}:{server.server_address[1]}  (Ctrl-C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
