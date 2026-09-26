import { describe, expect, it } from 'vitest';
import {
  NO_LABELS,
  fieldLabel,
  gateLabel,
  humanise,
  linkLabel,
  outcomeLabel,
  phaseLabel,
  stateLabel,
  typeLabel,
} from './labels';
import type { Labels } from './types';

const labels: Labels = {
  types: { business_case: { title: 'Business case', description: 'Is it worth solving?' } },
  gates: { explore: { title: 'Explore', outcomes: { request_changes: 'Ask for changes' } } },
  phases: { explore: 'Exploring' },
  links: { justified_by: 'Justified by the business case' },
  attribution: { oversight_level: 'Oversight level' },
};

describe('labels', () => {
  it('shows the declared word where the workspace gave one', () => {
    expect(typeLabel(labels, 'business_case')).toBe('Business case');
    expect(gateLabel(labels, 'explore')).toBe('Explore');
    expect(outcomeLabel(labels, 'explore', 'request_changes')).toBe('Ask for changes');
    expect(phaseLabel(labels, 'explore')).toBe('Exploring');
    expect(linkLabel(labels, 'justified_by')).toBe('Justified by the business case');
    expect(fieldLabel(labels, 'oversight_level')).toBe('Oversight level');
  });

  it('never shows a raw identifier where the workspace gave no word', () => {
    expect(typeLabel(labels, 'intake_assessment')).toBe('Intake assessment');
    expect(outcomeLabel(labels, 'explore', 'approve')).toBe('Approve');
    expect(outcomeLabel(labels, 'unknown_gate', 'request_changes')).toBe('Request changes');
    expect(phaseLabel(NO_LABELS, 'in_review')).toBe('In review');
    expect(linkLabel(NO_LABELS, 'derives_from')).toBe('Derives from');
    expect(humanise('a_b-c')).toBe('A b c');
  });

  it('has a plain word for every state the service owns', () => {
    for (const state of ['proposed', 'accepted', 'superseded', 'rejected', 'withdrawn', 'expired'] as const) {
      expect(stateLabel(state)).not.toMatch(/_/);
      expect(stateLabel(state)).not.toBe(state);
    }
  });
});
