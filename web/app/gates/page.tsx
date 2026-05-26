import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Non-functional stub: lays out the three things US-0030 says a reviewer does on a gate —
// read the repo-sourced spec, discuss in a thread, decide. Wired to the orchestrator in a later story.
export default function GatesPage() {
  return (
    <main className="container mx-auto max-w-5xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/" className="hover:underline">
              maestro
            </Link>{' '}
            / functional gate
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Acme Billing — Invoice Export</h1>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">stub · no backend</span>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Spec</CardTitle>
            <CardDescription>Rendered one-way from the product repo — read-only (ADR-0008).</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>The functional spec (EARS criteria) would render here from the repo&apos;s markdown.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
            <CardDescription>Role-authorized + attributed (ADR-0011/0009).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button disabled>Approve</Button>
            <Button variant="outline" disabled>
              Request changes
            </Button>
            <Button variant="destructive" disabled>
              Reject
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Discussion</CardTitle>
          <CardDescription>Per-gate thread; each message becomes an event via the orchestrator.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>spec-agent: 2 open questions flagged in the spec. Awaiting your decision on this gate.</p>
        </CardContent>
      </Card>
    </main>
  );
}
