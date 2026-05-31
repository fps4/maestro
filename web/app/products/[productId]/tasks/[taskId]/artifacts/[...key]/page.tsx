import Link from 'next/link';
import { ApiErrorNotice } from '@/components/api-error-notice';
import { ArtefactView } from '@/components/artefact-renderers/artefact-view';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getArtefactContent, getTask } from '@/lib/api';
import { specsPath, taskPath } from '@/lib/links';
import type { StoredArtefact, TaskDetail } from '@/lib/types';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  pr_diff: 'PR diff',
  test_report: 'Test report',
  sbom: 'SBOM',
  diff_snapshot: 'Diff snapshot',
  functional_spec: 'Functional spec',
  technical_design: 'Technical design',
};

// In-app artefact viewer (US-0033 AC #3/#4): fetch the clicked artefact's content server-side and
// render it with the structured renderer for its kind (diff / test report / SBOM), falling back to a
// raw view. The content is rendered in-app, never as a long-lived public link in the browser.
export default async function ArtefactViewerPage({
  params,
}: {
  params: Promise<{ productId: string; taskId: string; key: string[] }>;
}) {
  const { productId, taskId, key } = await params;
  const objectKey = key.join('/');

  // The artefact's kind/name come from the task index; the content comes from the store.
  let task: TaskDetail;
  try {
    task = await getTask(productId, taskId);
  } catch (error) {
    return (
      <Shell productId={productId} taskId={taskId}>
        <ApiErrorNotice error={error} />
      </Shell>
    );
  }
  const meta: StoredArtefact | undefined = task.stored_artefacts.find((a) => a.key === objectKey);

  let body: React.ReactNode;
  try {
    const content = await getArtefactContent(productId, objectKey);
    body = <ArtefactView kind={meta?.kind ?? ''} contentType={content.contentType} text={content.text} />;
  } catch (error) {
    // Unavailable / expired between mint and click: show a retry, never a stale copy (AC #7).
    body = (
      <div className="space-y-3">
        <ApiErrorNotice error={error} />
        <Link
          href={`${taskPath(productId, taskId)}/artifacts/${key.map(encodeURIComponent).join('/')}`}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Retry
        </Link>
      </div>
    );
  }

  return (
    <Shell productId={productId} taskId={taskId}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>{meta?.name ?? objectKey}</CardTitle>
              <CardDescription>
                {KIND_LABEL[meta?.kind ?? ''] ?? meta?.kind ?? 'artefact'} · resolved through the
                artefact store on demand (ADR-0012)
              </CardDescription>
            </div>
            <Link
              href={taskPath(productId, taskId)}
              className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              ← Back to task
            </Link>
          </div>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </Shell>
  );
}

function Shell({
  productId,
  taskId,
  children,
}: {
  productId: string;
  taskId: string;
  children: React.ReactNode;
}) {
  return (
    <main className="container mx-auto max-w-5xl px-6 py-10">
      <p className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          maestro
        </Link>{' '}
        /{' '}
        <Link href={specsPath(productId)} className="hover:underline">
          {productId}
        </Link>{' '}
        /{' '}
        <Link href={taskPath(productId, taskId)} className="hover:underline">
          tasks / <span className="font-mono">{taskId}</span>
        </Link>{' '}
        / artefact
      </p>
      <div className="mt-4">{children}</div>
    </main>
  );
}
