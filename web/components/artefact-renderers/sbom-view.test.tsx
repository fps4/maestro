import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SbomView, licenseLabel, type SbomComponent } from '@/components/artefact-renderers/sbom-view';

const COMPONENTS: SbomComponent[] = [
  {
    type: 'library',
    name: 'boto3',
    version: '1.35.0',
    purl: 'pkg:pypi/boto3@1.35.0',
    licenses: [{ license: { id: 'Apache-2.0' } }],
  },
  {
    type: 'library',
    name: 'react',
    version: '19.0.0',
    purl: 'pkg:npm/react@19.0.0',
    licenses: [{ license: { id: 'MIT' } }],
  },
];

describe('licenseLabel', () => {
  it('flattens id / name / expression and dedupes', () => {
    expect(licenseLabel([{ license: { id: 'MIT' } }])).toBe('MIT');
    expect(licenseLabel([{ expression: 'MIT OR Apache-2.0' }])).toBe('MIT OR Apache-2.0');
    expect(licenseLabel([{ license: { id: 'MIT' } }, { license: { id: 'MIT' } }])).toBe('MIT');
    expect(licenseLabel([])).toBe('—');
    expect(licenseLabel(undefined)).toBe('—');
  });
});

describe('SbomView', () => {
  it('renders a per-package table with name / version / license', () => {
    render(<SbomView components={COMPONENTS} />);
    expect(screen.getByText('boto3')).toBeInTheDocument();
    expect(screen.getByText('1.35.0')).toBeInTheDocument();
    expect(screen.getByText('Apache-2.0')).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 packages/)).toBeInTheDocument();
  });

  it('filters by the search box across name / version / license / purl', () => {
    render(<SbomView components={COMPONENTS} />);
    fireEvent.change(screen.getByRole('searchbox', { name: /filter packages/i }), {
      target: { value: 'react' },
    });
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.queryByText('boto3')).not.toBeInTheDocument();
    expect(screen.getByText(/1 of 2 packages/)).toBeInTheDocument();
  });

  it('shows a no-match row when the filter excludes everything', () => {
    render(<SbomView components={COMPONENTS} />);
    fireEvent.change(screen.getByRole('searchbox', { name: /filter packages/i }), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText(/No packages match/)).toBeInTheDocument();
  });
});
