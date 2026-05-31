// Dispatcher (US-0033 AC #3/#4): pick the structured renderer for an artefact by its `kind`, parsing
// the fetched content. Any parse failure or unknown kind falls back to RawView so the viewer never
// throws (AC #7). Shapes: docs/architecture/contracts/artifact-content-schemas.md.

import { PrDiffView, type PrDiff } from '@/components/artefact-renderers/pr-diff-view';
import { RawView } from '@/components/artefact-renderers/raw-view';
import { SbomView, type SbomComponent } from '@/components/artefact-renderers/sbom-view';
import { TestReportView, type TestReport } from '@/components/artefact-renderers/test-report-view';

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function ArtefactView({
  kind,
  contentType,
  text,
}: {
  kind: string;
  contentType: string;
  text: string;
}) {
  if (kind === 'pr_diff') {
    const data = tryParse(text) as PrDiff | undefined;
    if (data && Array.isArray(data.files)) return <PrDiffView diff={data} />;
  }

  if (kind === 'test_report') {
    const data = tryParse(text) as TestReport | undefined;
    if (data && Array.isArray(data.scenarios)) return <TestReportView report={data} />;
  }

  if (kind === 'sbom') {
    const data = tryParse(text) as { components?: SbomComponent[] } | undefined;
    if (data && Array.isArray(data.components)) return <SbomView components={data.components} />;
  }

  return <RawView text={text} contentType={contentType} />;
}
