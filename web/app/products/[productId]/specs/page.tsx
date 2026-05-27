import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiErrorNotice } from '@/components/api-error-notice';
import { SpecStatusBadges } from '@/components/spec-status';
import { listSpecs } from '@/lib/api';
import { specPath } from '@/lib/links';
import type { SpecKind } from '@/lib/types';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<SpecKind, string> = {
  functional_spec: 'Functional spec',
  technical_design: 'Technical design',
};

export default async function SpecsPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;

  let index;
  try {
    index = await listSpecs(productId);
  } catch (error) {
    return (
      <Shell productId={productId} productName={productId}>
        <ApiErrorNotice error={error} />
      </Shell>
    );
  }

  const { product, specs, unindexed } = index;
  return (
    <Shell productId={productId} productName={product.name}>
      {specs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No specs yet</CardTitle>
            <CardDescription>
              Nothing on the default branch carries a <code>maestro:</code> frontmatter block yet.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {specs.map((s) => (
            <li key={`${s.ref.repo}:${s.ref.branch}:${s.kind}:${s.feature}`}>
              <Link href={specPath(productId, s.feature, s.kind, s.ref.branch)} className="block rounded-xl">
                <Card className="transition-colors hover:bg-accent">
                  <CardHeader className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base">{s.title}</CardTitle>
                      <Badge variant="outline">{KIND_LABEL[s.kind]}</Badge>
                    </div>
                    <CardDescription className="font-mono text-xs">
                      {s.ref.repo} · {s.ref.branch}
                      {s.task ? ` · ${s.task}` : ''}
                    </CardDescription>
                    <SpecStatusBadges status={s.status} />
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {unindexed.length > 0 && (
        <Card className="mt-6 border-muted">
          <CardHeader>
            <CardTitle className="text-base">Unindexed</CardTitle>
            <CardDescription>
              Docs that declare a <code>maestro:</code> block we couldn&apos;t honour — surfaced, never
              guessed (ADR-0018).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {unindexed.map((u) => (
                <li key={`${u.ref.branch}:${u.ref.path}`} className="font-mono text-xs">
                  {u.ref.path} — {u.reason}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </Shell>
  );
}

function Shell({
  productId,
  productName,
  children,
}: {
  productId: string;
  productName: string;
  children: React.ReactNode;
}) {
  return (
    <main className="container mx-auto max-w-4xl px-6 py-12">
      <p className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          maestro
        </Link>{' '}
        / {productName}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Specs &amp; designs</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Read-only, rendered from <span className="font-mono">{productId}</span>&apos;s repo and annotated
        with live status.
      </p>
      <div className="mt-8">{children}</div>
    </main>
  );
}
