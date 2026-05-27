import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiErrorNotice } from '@/components/api-error-notice';
import { listProducts } from '@/lib/api';
import { specsPath } from '@/lib/links';

export const dynamic = 'force-dynamic'; // per-request: live API + caller identity

export default async function Home() {
  let products;
  try {
    products = await listProducts();
  } catch (error) {
    return (
      <Page>
        <ApiErrorNotice error={error} />
      </Page>
    );
  }

  return (
    <Page>
      {products.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No products</CardTitle>
            <CardDescription>
              You don&apos;t participate in any product yet — membership lives in the register (ADR-0011).
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-3">
          {products.map((p) => (
            <Link key={p.id} href={specsPath(p.id)} className="block rounded-xl">
              <Card className="transition-colors hover:bg-accent">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div className="space-y-1.5">
                    <CardTitle>{p.name}</CardTitle>
                    <CardDescription>{p.product_type}</CardDescription>
                  </div>
                  {p.role && <Badge variant="secondary">{p.role}</Badge>}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <main className="container mx-auto max-w-3xl px-6 py-16">
      <p className="text-sm font-medium text-muted-foreground">maestro</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Workspace</h1>
      <p className="mt-3 text-muted-foreground">
        Your products. Open one to read its specs and designs — rendered one-way from the repo,
        annotated with live status. A read-only projection (ADR-0015/0018).
      </p>
      <div className="mt-8">{children}</div>
    </main>
  );
}
