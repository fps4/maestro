/** The shapes runtime-service returns (maestro ADR-0027), written down for the reason `types.ts` gives. */

export interface Instance {
  instance_id: string;
  application: string;
  environment: string;
  digest: string;
  commit: string;
  deployed_at: string;
  deployed_by: string;
  rollback_target?: string;
  /** `mismatched`: the running digest has no build record — a hard stop, never corrected in place. */
  state: 'running' | 'mismatched';
  onboarding_level?: string;
  tier?: string;
  revision: number;
}

export interface Deploy {
  application: string;
  environment: string;
  digest: string;
  commit: string;
  deployed_at: string;
  deployed_by: string;
  previous?: string;
  mismatch: boolean;
  revision: number;
}

export interface Artifact {
  application: string;
  digest: string;
  commit: string;
  version?: string;
  built: boolean;
  recorded_at: string;
  revision: number;
}
