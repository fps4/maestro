import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ArtefactView } from '@/components/artefact-renderers/artefact-view';

describe('ArtefactView dispatcher', () => {
  it('renders a test report for kind test_report', () => {
    const text = JSON.stringify({
      summary: { total: 1, passed: 0, failed: 1 },
      scenarios: [{ id: 'x', status: 'failed', message: 'boom' }],
    });
    render(<ArtefactView kind="test_report" contentType="application/json" text={text} />);
    expect(screen.getByText('1 failed')).toBeInTheDocument();
  });

  it('renders an SBOM table for kind sbom', () => {
    const text = JSON.stringify({ components: [{ name: 'boto3', version: '1.0.0' }] });
    render(<ArtefactView kind="sbom" contentType="application/json" text={text} />);
    expect(screen.getByText('boto3')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /filter packages/i })).toBeInTheDocument();
  });

  it('renders a PR diff (file paths) for kind pr_diff', () => {
    const text = JSON.stringify({
      files: [{ path: 'a/b.py', status: 'modified', old: 'x', new: 'y' }],
    });
    render(<ArtefactView kind="pr_diff" contentType="application/json" text={text} />);
    expect(screen.getByText('a/b.py')).toBeInTheDocument();
  });

  it('falls back to a raw view for an unknown kind', () => {
    render(<ArtefactView kind="mystery" contentType="text/plain" text="just some text" />);
    expect(screen.getByText('just some text')).toBeInTheDocument();
  });

  it('falls back to a raw view when the structured content fails to parse', () => {
    render(<ArtefactView kind="test_report" contentType="application/json" text="not json {" />);
    // No summary badge — it degraded to raw rather than throwing (AC #7).
    expect(screen.queryByText(/failed|passed/)).not.toBeInTheDocument();
    expect(screen.getByText(/not json/)).toBeInTheDocument();
  });
});
