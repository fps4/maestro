import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';

// Turn a read-API failure into an honest, actionable notice — matching the contract's error model
// (unauthenticated / not_found / degraded), plus the dev case where the API isn't running.
export function ApiErrorNotice({ error }: { error: unknown }) {
  const { title, detail } = describe(error);
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        The workspace is a read-only projection — it shows what the orchestrator and repo report. Nothing
        was changed.
      </CardContent>
    </Card>
  );
}

function describe(error: unknown): { title: string; detail: string } {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'unreachable':
        return {
          title: 'Read API unreachable',
          detail: `${error.message}. Start it with \`maestro serve\` (or set MAESTRO_API_URL).`,
        };
      case 'unauthenticated':
        return {
          title: 'Sign-in required',
          detail:
            'No caller identity. In local dev set MAESTRO_DEV_IDENTITY to a participant email; in production this comes from Cloudflare Access + component-auth (ADR-0019).',
        };
      case 'not_found':
        return { title: 'Not found', detail: error.message };
      case 'degraded':
        return {
          title: 'Temporarily unavailable',
          detail: `${error.message}. This is usually transient — try again shortly.`,
        };
      default:
        return { title: 'Something went wrong', detail: error.message };
    }
  }
  return { title: 'Something went wrong', detail: 'Unexpected error talking to the read API.' };
}
