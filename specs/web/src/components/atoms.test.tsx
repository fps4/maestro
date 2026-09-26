import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Chip, Provenance, relativeDate, shortDigest } from './atoms';

/**
 * These pin the two properties the design commits to, so a refactor that quietly drops them fails
 * rather than merely looking different.
 */
describe('Chip', () => {
  it('distinguishes a proposed version from an accepted one by form, not only by colour', () => {
    const { container: proposed } = render(<Chip state="proposed">proposed</Chip>);
    const { container: accepted } = render(<Chip state="accepted">accepted</Chip>);

    // Dashed means in flight; filled means decided. Remove the hue and the two still read.
    expect(proposed.firstElementChild?.className).toContain('border-dashed');
    expect(accepted.firstElementChild?.className).not.toContain('border-dashed');
    expect(accepted.firstElementChild?.className).toContain('bg-accent-soft');
  });

  it('strikes a withdrawn chip, so retraction is legible without colour', () => {
    const { container } = render(<Chip state="withdrawn">withdrawn</Chip>);
    expect(container.firstElementChild?.className).toContain('line-through');
  });

  it('falls back to a neutral style for a state it has never seen', () => {
    // Workspace definitions declare their own outcomes, so an unknown value is expected input
    // rather than a bug — it must render, not crash.
    const { container } = render(<Chip state="some_future_state">future</Chip>);
    expect(container.firstElementChild?.className).toContain('text-muted');
  });
});

describe('Provenance', () => {
  it('marks an unconfirmed extraction as unconfirmed, in words', () => {
    render(<Provenance source="extracted" confirmed={false} />);
    expect(screen.getByText(/extracted · unconfirmed/)).toBeTruthy();
  });

  it('marks a confirmed extraction differently, because the assurance weight differs', () => {
    render(<Provenance source="extracted" confirmed by="prn-dekker" />);
    expect(screen.getByText(/extracted · confirmed · prn-dekker/)).toBeTruthy();
  });

  it('shows a declared facet as declared', () => {
    render(<Provenance source="declared" />);
    expect(screen.getByText(/declared/)).toBeTruthy();
  });
});

describe('shortDigest', () => {
  it('abbreviates for display', () => {
    expect(shortDigest(`sha256:${'a'.repeat(64)}`)).toBe('sha256:aaaaaa…aaaa');
  });

  it('leaves something too short to abbreviate alone rather than mangling it', () => {
    expect(shortDigest('sha256:abc')).toBe('sha256:abc');
  });
});

describe('relativeDate', () => {
  it('says today for now', () => {
    expect(relativeDate(new Date().toISOString())).toBe('today');
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(relativeDate('not a date')).toBe('not a date');
  });
});
