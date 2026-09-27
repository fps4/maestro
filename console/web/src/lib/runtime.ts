import 'server-only';

/** Reads against runtime-service: the estate, an instance with its deploys, an artifact (client: `service.ts`). */

import { AUTH_MODE } from './session';
import { serviceCaller } from './service';
import type { Artifact, Deploy, Instance } from './runtime-types';

const call = serviceCaller({
  name: 'runtime-service',
  base: process.env.RUNTIME_API_PROXY_TARGET ?? (AUTH_MODE === 'dev' ? 'http://127.0.0.1:8051' : ''),
  devToken: process.env.RUNTIME_DEV_TOKEN ?? 'dev:prn-h-demo-owner:owner',
});

export async function fetchEstate(): Promise<Instance[]> {
  return (await call<{ instances: Instance[] }>('GET', '/instances')).instances;
}

export const fetchInstance = (application: string, environment: string) =>
  call<{ instance: Instance; deploys: Deploy[] }>(
    'GET',
    `/instances/${encodeURIComponent(application)}/${encodeURIComponent(environment)}`,
  );

export async function fetchArtifact(application: string, digest: string): Promise<Artifact | null> {
  try {
    return (
      await call<{ artifact: Artifact }>(
        'GET',
        `/artifacts/${encodeURIComponent(application)}/${encodeURIComponent(digest)}`,
      )
    ).artifact;
  } catch {
    return null;
  }
}
