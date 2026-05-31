import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TestReportView, type TestReport } from '@/components/artefact-renderers/test-report-view';

const REPORT: TestReport = {
  tool: 'pytest',
  summary: { total: 3, passed: 1, failed: 1, skipped: 1 },
  scenarios: [
    { id: 't::passes', name: 'passes', criterion: 'AC-1', status: 'passed' },
    { id: 't::skips', name: 'skips', status: 'skipped' },
    {
      id: 't::fails',
      name: 'fails the criterion',
      criterion: 'AC-2',
      status: 'failed',
      message: 'expected 200, got 500',
      detail: 'Traceback: boom at line 7',
    },
  ],
};

describe('TestReportView', () => {
  it('summarises pass/fail and lists scenarios fail-first', () => {
    render(<TestReportView report={REPORT} />);
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    // Fail-first ordering: the failing scenario leads.
    expect(within(items[0]).getByText('fails the criterion')).toBeInTheDocument();
    expect(within(items[0]).getByText('AC-2')).toBeInTheDocument();
    expect(within(items[0]).getByText(/expected 200, got 500/)).toBeInTheDocument();
  });

  it('expands a failing scenario detail on demand', () => {
    render(<TestReportView report={REPORT} />);
    expect(screen.queryByText(/Traceback: boom/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show detail/i }));
    expect(screen.getByText(/Traceback: boom at line 7/)).toBeInTheDocument();
  });

  it('shows an all-passed badge when nothing failed', () => {
    render(
      <TestReportView
        report={{ summary: { total: 1, passed: 1, failed: 0 }, scenarios: [
          { id: 'a', status: 'passed' },
        ] }}
      />,
    );
    expect(screen.getByText('all passed')).toBeInTheDocument();
    // No failing scenario ⇒ no detail toggle.
    expect(screen.queryByRole('button', { name: /detail/i })).not.toBeInTheDocument();
  });
});
