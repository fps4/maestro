import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ApiErrorNotice } from '@/components/api-error-notice';
import { Markdown } from '@/components/markdown';
import { SpecStatusBadges } from '@/components/spec-status';
import { getSpec } from '@/lib/api';
import { specsPath } from '@/lib/links';
import type { SpecKind } from '@/lib/types';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<SpecKind, string> = {
  functional_spec: 'Functional spec',
  technical_design: 'Technical design',
};

// The content arrives as-committed, frontmatter and all; strip the leading block — its fields are shown
// separately, and rendering it as markdown would just print the YAML.
function stripFrontmatter(md: string): string {
  const m = /^---\n[\s\S]*?\n---\n?/.exec(md);
  return m ? md.slice(m[0].length) : md;
}

export default async function SpecDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string; feature: string; kind: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { productId, feature, kind } = await params;
  const { branch } = await searchParams;

  let doc;
  try {
    doc = await getSpec(productId, feature, kind, branch);
  } catch (error) {
    return (
      <Shell productId={productId}>
        <ApiErrorNotice error={error} />
      </Shell>
    );
  }

  return (
    <Shell productId={productId}>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
        <Badge variant="outline">{KIND_LABEL[doc.kind] ?? doc.kind}</Badge>
      </div>
      <div className="mt-3">
        <SpecStatusBadges status={doc.status} />
      </div>
      <p className="mt-3 font-mono text-xs text-muted-foreground">
        {doc.ref.repo} · {doc.ref.branch} · {doc.ref.path} · {doc.ref.commit.slice(0, 12)}
      </p>

      <Card className="mt-6">
        <CardContent className="pt-6">
          <Markdown>{stripFrontmatter(doc.content)}</Markdown>
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ productId, children }: { productId: string; children: React.ReactNode }) {
  return (
    <main className="container mx-auto max-w-4xl px-6 py-12">
      <p className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          maestro
        </Link>{' '}
        /{' '}
        <Link href={specsPath(productId)} className="hover:underline">
          {productId}
        </Link>{' '}
        / spec
      </p>
      <div className="mt-4">{children}</div>
    </main>
  );
}
