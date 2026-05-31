import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ArtefactsPanel, formatBytes } from '@/components/artefacts-panel';
import type { StoredArtefact } from '@/lib/types';

function artefact(over: Partial<StoredArtefact> = {}): StoredArtefact {
  return {
    kind: 'pr_diff',
    name: 'pr-diff.patch',
    key: 'tasks/t/pr-diff.patch',
    content_type: 'text/x-diff',
    size: 2048,
    sha256: 'a'.repeat(64),
    source: { event: 'pr.opened', seq: 5 },
    stored_at: 1_700_000_000,
    seq: 7,
    href: '/api/products/maestro/artifacts/tasks/t/pr-diff.patch',
    ...over,
  };
}

describe('formatBytes', () => {
  it('renders human sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('ArtefactsPanel', () => {
  it('shows an empty state when there are no artefacts', () => {
    render(<ArtefactsPanel productId="maestro" taskId="t" artefacts={[]} />);
    expect(screen.getByText(/No artefacts yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('renders one entry per artefact with kind, name, size and source', () => {
    render(
      <ArtefactsPanel
        productId="maestro"
        taskId="t"
        artefacts={[
          artefact(),
          artefact({ kind: 'sbom', name: 'sbom.spdx.json', key: 'tasks/t/sbom.spdx.json', size: 900, source: null }),
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);

    const first = within(items[0]);
    expect(first.getByText('PR diff')).toBeInTheDocument();
    expect(first.getByText('pr-diff.patch')).toBeInTheDocument();
    expect(first.getByText(/2\.0 KB/)).toBeInTheDocument();
    expect(first.getByText(/from pr\.opened/)).toBeInTheDocument();

    const second = within(items[1]);
    expect(second.getByText('SBOM')).toBeInTheDocument();
    expect(second.getByText(/900 B/)).toBeInTheDocument();
    // No source breadcrumb when source is null.
    expect(second.queryByText(/from /)).not.toBeInTheDocument();
  });

  it('links View to the in-app viewer and Raw to the redirect route (per-segment encoded)', () => {
    render(<ArtefactsPanel productId="maestro" taskId="task-9" artefacts={[artefact()]} />);
    // View → the task-scoped in-app viewer (renders the structured artefact).
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute(
      'href',
      '/products/maestro/tasks/task-9/artifacts/tasks/t/pr-diff.patch',
    );
    // Raw → the redirect route (forwards identity, 302s to the presigned URL). Never the /api/... href.
    expect(screen.getByRole('link', { name: 'Raw' })).toHaveAttribute(
      'href',
      '/products/maestro/artifacts/tasks/t/pr-diff.patch',
    );
  });

  it('falls back to the raw kind string for an unknown kind', () => {
    render(<ArtefactsPanel productId="maestro" taskId="t" artefacts={[artefact({ kind: 'mystery' })]} />);
    expect(screen.getByText('mystery')).toBeInTheDocument();
  });
});
