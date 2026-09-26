import 'server-only';

/**
 * Server-side reads against the api.
 *
 * Pages are server components and call this directly, reaching the api service over the compose
 * network. Anything importing `next/headers` cannot be reached from a client component, which is
 * what keeps this file out of the browser bundle by construction rather than by discipline.
 */

import { currentToken, currentWorkspace } from './auth';
import { NO_LABELS } from './labels';
import type {
  Acceptance,
  Artifact,
  Decision,
  DecisionPacket,
  Draft,
  GateView,
  Labels,
  Lineage,
  Question,
  Readiness,
  RegisterRow,
  StandardSummary,
  Version,
  VersionDiff,
  WorkspaceDefinition,
} from './types';

const BASE = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8020';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function get<T>(path: string): Promise<T> {
  const token = await currentToken();
  const response = await fetch(`${BASE}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    // A record surface must never show a cached version of something that has since been decided.
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(response.status, body.message ?? `${response.status} from ${path}`, body);
  }
  return (await response.json()) as T;
}

async function ws(): Promise<string> {
  return currentWorkspace();
}

export async function fetchRegister(): Promise<RegisterRow[]> {
  const { register } = await get<{ register: RegisterRow[] }>(`/v1/workspaces/${await ws()}/register`);
  return register;
}

export async function fetchDefinition(): Promise<{
  definition: WorkspaceDefinition;
  record: { id: string; kind: string; title?: string; definition_version: number };
  labels: Labels;
}> {
  return get(`/v1/workspaces/${await ws()}/definition`);
}

/**
 * The words for this workspace's identifiers.
 *
 * Never throws: a page that cannot load the definition still renders words, humanised from the ids,
 * rather than failing on the one thing a reader needs least.
 */
export async function fetchLabels(): Promise<Labels> {
  try {
    const { labels } = await fetchDefinition();
    return labels;
  } catch {
    return NO_LABELS;
  }
}

export async function fetchArtifact(id: string): Promise<{
  artifact: Artifact;
  versions: Version[];
  decisions: Decision[];
}> {
  return get(`/v1/workspaces/${await ws()}/artifacts/${id}`);
}

export async function fetchVersion(
  id: string,
  ordinal: number,
  render = false,
): Promise<{ version: Version; rendered?: { html: string; unresolved: string[] } }> {
  return get(`/v1/workspaces/${await ws()}/artifacts/${id}/versions/${ordinal}${render ? '?render=1' : ''}`);
}

export async function fetchDiff(id: string, from: number, to: number): Promise<VersionDiff> {
  const { diff } = await get<{ diff: VersionDiff }>(
    `/v1/workspaces/${await ws()}/artifacts/${id}/diff?from=${from}&to=${to}`,
  );
  return diff;
}

export async function fetchLineage(id: string): Promise<Lineage> {
  const { lineage } = await get<{ lineage: Lineage }>(`/v1/workspaces/${await ws()}/artifacts/${id}/lineage`);
  return lineage;
}

export async function fetchDraft(id: string): Promise<Draft> {
  const { draft } = await get<{ draft: Draft }>(`/v1/workspaces/${await ws()}/drafts/${id}`);
  return draft;
}

/** A draft as one document — front-matter and body — with the revision to save it against. */
export async function fetchDocument(id: string): Promise<{ document: string; revision: number }> {
  return get(`/v1/workspaces/${await ws()}/drafts/${id}/document`);
}

export async function fetchReadiness(id: string): Promise<Readiness> {
  const { readiness } = await get<{ readiness: Readiness }>(
    `/v1/workspaces/${await ws()}/drafts/${id}/readiness`,
  );
  return readiness;
}

export async function fetchDrafts(): Promise<Draft[]> {
  const { drafts } = await get<{ drafts: Draft[] }>(`/v1/workspaces/${await ws()}/drafts`);
  return drafts;
}

export async function fetchGateView(gate: string, artifact: string, ordinal: number): Promise<GateView> {
  const { view } = await get<{ view: GateView }>(
    `/v1/workspaces/${await ws()}/gates/${gate}/${artifact}/${ordinal}`,
  );
  return view;
}

/** The decider's packet — the whole decision screen in one call, in plain language. */
export async function fetchPacket(gate: string, artifact: string, ordinal: number): Promise<DecisionPacket> {
  const { packet } = await get<{ packet: DecisionPacket }>(
    `/v1/workspaces/${await ws()}/gates/${gate}/${artifact}/${ordinal}/packet`,
  );
  return packet;
}

export async function fetchQuestions(artifact: string, ordinal: number): Promise<Question[]> {
  const { questions } = await get<{ questions: Question[] }>(
    `/v1/workspaces/${await ws()}/artifacts/${artifact}/versions/${ordinal}/questions`,
  );
  return questions;
}

export async function fetchStandards(): Promise<StandardSummary[]> {
  const { standards } = await get<{ standards: StandardSummary[] }>(
    `/v1/workspaces/${await ws()}/catalogue/standards`,
  );
  return standards;
}

export async function fetchStandard(
  artifact: string,
): Promise<{ standard: Version; rendered: { html: string } }> {
  return get(`/v1/workspaces/${await ws()}/catalogue/standards/${artifact}`);
}

export async function fetchAcceptances(): Promise<Acceptance[]> {
  const { acceptances } = await get<{ acceptances: Acceptance[] }>(
    `/v1/workspaces/${await ws()}/acceptances`,
  );
  return acceptances;
}

export async function search(query: string): Promise<Version[]> {
  const { results } = await get<{ results: Version[] }>(
    `/v1/workspaces/${await ws()}/search?q=${encodeURIComponent(query)}`,
  );
  return results;
}
