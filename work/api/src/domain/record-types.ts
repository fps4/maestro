/**
 * The event types this service emits and their body schemas, keyed `Type@version` for the spine's
 * append check (maestro ADR-0019 §8). The spine's floor applies to every body — tokens only, never
 * prose — and a type's schema here narrows it. Empty until the work item lands.
 */

import type { TypeSchemas } from '@fps4/maestro-spine';

export const RECORD_TYPES: TypeSchemas = new Map();
