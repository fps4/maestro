"""The single LLM egress (ADR-0002), spike edition.

Every agent reasons through this one client — never a provider SDK directly — and every call is
recorded (ADR-0009). By default it returns a canned completion so the spike runs with no network or
keys; set MAESTRO_REAL_LLM=1 (+ ANTHROPIC_API_KEY) to make a real Claude call instead.
"""
import json
import os
import pathlib
import time


class ModelClient:
    def __init__(self, audit_path):
        self.audit = pathlib.Path(audit_path)
        self.model = os.environ.get("MAESTRO_MODEL", "claude-stub")

    def complete(self, agent: str, prompt: str) -> str:
        t0 = time.time()
        text = self._call(prompt)
        self._record(agent, prompt, text, int((time.time() - t0) * 1000))
        return text

    def _call(self, prompt: str) -> str:
        if os.environ.get("MAESTRO_REAL_LLM") and os.environ.get("ANTHROPIC_API_KEY"):
            try:
                import anthropic
                client = anthropic.Anthropic()
                msg = client.messages.create(
                    model=os.environ.get("MAESTRO_MODEL", "claude-sonnet-4-6"),
                    max_tokens=400,
                    messages=[{"role": "user", "content": prompt}],
                )
                return msg.content[0].text
            except Exception as exc:  # spike: fall back to the stub rather than crash
                return f"[stub — real call failed: {exc}] {prompt.splitlines()[0][:80]}"
        return f"[stub completion] {prompt.splitlines()[0][:80]}"

    def _record(self, agent: str, prompt: str, text: str, latency_ms: int) -> None:
        with self.audit.open("a") as fh:
            fh.write(json.dumps({
                "agent": agent, "model": self.model,
                "input_tokens": len(prompt) // 4, "output_tokens": len(text) // 4,
                "latency_ms": latency_ms,
            }) + "\n")
