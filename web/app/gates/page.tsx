import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// The old /gates stub has been superseded — gate decisions live on the per-task page
// (/products/{p}/tasks/{t}), so a reviewer reaches the gate by clicking into a task from the
// specs index. This page now just points the curious there.
export default function GatesPage() {
  return (
    <main className="container mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          maestro
        </Link>{' '}
        / gates
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Gates live on tasks</h1>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Open a task to decide its gate</CardTitle>
          <CardDescription>
            From a product page (the home → product list), open a spec or design to see its task —
            or click <em>view task</em> in the specs index. M3 adds the per-participant inbox that
            replaces this page (US-0030 §S6).
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          For M1 dogfood the architect navigates by product → task; a cross-product inbox is
          deliberately out of scope until M3.
        </CardContent>
      </Card>
    </main>
  );
}
