import Link from 'next/link';
import { ApiErrorNotice } from '@/components/api-error-notice';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listProducts } from '@/lib/api';
import { specsPath } from '@/lib/links';
import { NewTaskForm } from './new-task-form';

export const dynamic = 'force-dynamic';

export default async function NewTaskPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  // We only need a product's repo list + role to render. The read API enforces architect-only
  // dispatch (M1; workspace-write-api.md §POST-tasks), so the form is still shown to non-architect
  // participants — the server action surfaces the 403 in the error block. That's the friendly
  // "you can't" path; a UI-only gate would lie.
  let products;
  try {
    products = await listProducts();
  } catch (error) {
    return (
      <Shell productId={productId}>
        <ApiErrorNotice error={error} />
      </Shell>
    );
  }
  const product = products.find((p) => p.id === productId);
  if (!product) {
    return (
      <Shell productId={productId}>
        <Card>
          <CardHeader>
            <CardTitle>Not found</CardTitle>
            <CardDescription>
              {productId} isn&apos;t visible to your identity (per-product isolation, ADR-0010/0011).
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  // Repos aren't in `/api/products` — list_specs walks them, but for the new-task form the
  // server action accepts an empty `repo` and the orchestrator falls back to `product.repos[0]`
  // (workspace-write-api.md §POST-tasks). We pass a single-element list here so the hidden input
  // pattern works either way; M3 can add a multi-repo selector when products grow.
  const repos: string[] = [];

  return (
    <Shell productId={productId}>
      <Card>
        <CardHeader>
          <CardTitle>New task</CardTitle>
          <CardDescription>
            Dispatch a unit of work to <span className="font-mono">{product.name}</span>. The spec
            agent will draft a functional spec from your intent and post it to the functional gate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewTaskForm productId={productId} repos={repos} />
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ productId, children }: { productId: string; children: React.ReactNode }) {
  return (
    <main className="container mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          maestro
        </Link>{' '}
        /{' '}
        <Link href={specsPath(productId)} className="hover:underline">
          {productId}
        </Link>{' '}
        / new task
      </p>
      <div className="mt-6">{children}</div>
    </main>
  );
}
