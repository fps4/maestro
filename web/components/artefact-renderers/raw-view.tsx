// Fallback renderer (US-0033 AC #7): when an artefact's kind/content isn't one of the structured
// shapes — or fails to parse — show it raw so the viewer never breaks. JSON is pretty-printed;
// everything else renders monospace.

export function prettyIfJson(text: string, contentType: string): string {
  if (contentType.includes('json') || /^\s*[[{]/.test(text)) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* not valid JSON — show as-is */
    }
  }
  return text;
}

export function RawView({ text, contentType }: { text: string; contentType: string }) {
  return (
    <pre className="max-h-[70vh] overflow-auto rounded-md border bg-muted p-3 text-xs">
      {prettyIfJson(text, contentType)}
    </pre>
  );
}
