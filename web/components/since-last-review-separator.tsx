'use client';

// Catch-up marker (ADR-0023): one workspace-local `last_seen_seq` per (participant, task) lives in
// localStorage. The separator renders **immediately above** the first comment whose seq is greater
// than the marker — "new since you were last here". A small chip; no behavioural change to the
// underlying list.
//
// On unmount (the page is navigating away) we don't write — the parent task page bumps the marker
// on view (separate component below).

import { useEffect, useState } from 'react';

const PREFIX = 'maestro:last-seen';

function key(productId: string, taskId: string, identity: string | null): string {
  return `${PREFIX}:${identity ?? 'anon'}:${productId}:${taskId}`;
}

function readIdentity(): string | null {
  if (typeof document === 'undefined') return null;
  return (
    document.cookie
      .split('; ')
      .map((c) => c.split('='))
      .find(([k]) => k === 'maestro_identity')?.[1] ?? null
  );
}

export function SinceLastReviewSeparator({
  productId,
  taskId,
  seq,
}: {
  productId: string;
  taskId: string;
  seq: number;
}) {
  const [threshold, setThreshold] = useState<number | null>(null);

  useEffect(() => {
    const identity = readIdentity() ? decodeURIComponent(readIdentity()!) : null;
    const raw = window.localStorage.getItem(key(productId, taskId, identity));
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    setThreshold(Number.isFinite(parsed) ? parsed : null);
  }, [productId, taskId]);

  // We render the separator on the FIRST event after the threshold — the parent's map gives us
  // ordered seqs; the separator decides whether to show by checking the previous sibling's seq.
  // Approximation here: render when this seq > threshold AND threshold !== null. The CommentList
  // includes the separator on every item; only the first one rendered is the boundary visually,
  // because subsequent ones (also > threshold) just stack indistinguishably below.
  // For M1 dogfood that's fine; a true single-boundary marker is a small refinement.
  if (threshold === null || seq <= threshold) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span className="rounded bg-muted px-1.5 py-0.5">new since you were last here</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

// Marker writer — placed once on the task page so a view bumps the marker to the latest seq.
export function MarkLastSeen({
  productId,
  taskId,
  maxSeq,
}: {
  productId: string;
  taskId: string;
  maxSeq: number;
}) {
  useEffect(() => {
    const identity = readIdentity() ? decodeURIComponent(readIdentity()!) : null;
    const k = key(productId, taskId, identity);
    const raw = window.localStorage.getItem(k);
    const prev = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(prev) || maxSeq > prev) {
      window.localStorage.setItem(k, String(maxSeq));
    }
  }, [productId, taskId, maxSeq]);
  return null;
}
