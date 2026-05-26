import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Home() {
  return (
    <main className="container mx-auto max-w-3xl px-6 py-16">
      <p className="text-sm font-medium text-muted-foreground">maestro</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Reviewer surface</h1>
      <p className="mt-3 text-muted-foreground">
        The functional reviewer&apos;s home — read a product&apos;s spec, discuss it, and decide the
        gate. This webapp is a <strong>surface</strong>: every comment and decision becomes an event in
        maestro&apos;s own log; the repo and the event store stay authoritative (ADR-0008/0015).
      </p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Scaffold</CardTitle>
          <CardDescription>
            MIT/open base (shadcn/ui + Next.js + Tailwind). Not yet wired to the orchestrator — the gate
            view below is a non-functional stub pending the engine&apos;s gate/event API (US-0030).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/gates">View gates (stub)</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
