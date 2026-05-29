// Comments grouped by anchor (US-0032 §discuss). Each comment shows the author + body + any
// matching `addresses[]` reply from a later `agent_response.posted` (the refinement loop's
// per-anchor closure — ADR-0022).
//
// Server component: pure rendering, no fetches.

import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { Address, AgentResponse, Comment } from '@/lib/types';
import { SinceLastReviewSeparator } from './since-last-review-separator';

const ACTION_LABEL: Record<Address['action'], { label: string; variant: BadgeProps['variant'] }> = {
  addressed: { label: 'addressed', variant: 'success' },
  deferred: { label: 'deferred', variant: 'secondary' },
  rejected: { label: 'agent disagreed', variant: 'destructive' },
};

function formatAnchor(c: Comment): string {
  const loc = c.anchor?.locator;
  if (!loc) return '';
  if (loc.criterion_id) return loc.criterion_id;
  if (loc.heading) return `# ${loc.heading}`;
  return '(anchor)';
}

function latestAddressFor(commentId: string, responses: AgentResponse[]): Address | undefined {
  // Most-recent response per comment wins (a comment can be `addressed` in cycle 1 and then
  // re-included if re-anchored later — ADR-0020 composition rule §3 means addressed comments
  // aren't re-bundled, but a future shape could differ; we want the latest answer either way).
  for (let i = responses.length - 1; i >= 0; i -= 1) {
    const hit = responses[i].addresses.find((a) => a.comment_id === commentId);
    if (hit) return hit;
  }
  return undefined;
}

export function CommentList({
  productId,
  taskId,
  comments,
  responses,
}: {
  productId: string;
  taskId: string;
  comments: Comment[];
  responses: AgentResponse[];
}) {
  if (comments.length === 0) {
    return <p className="text-sm text-muted-foreground">No comments yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {comments.map((c) => {
        const anchor = formatAnchor(c);
        const address = latestAddressFor(c.comment_id, responses);
        const action = address ? ACTION_LABEL[address.action] : null;
        return (
          <li key={c.comment_id} id={`comment-${c.comment_id}`} className="space-y-1.5">
            <SinceLastReviewSeparator productId={productId} taskId={taskId} seq={c.seq} />
            <div className="rounded-md border bg-card p-3">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{c.author ?? '(unknown)'}</span>
                <div className="flex items-center gap-1.5">
                  {anchor && <Badge variant="outline">{anchor}</Badge>}
                  {action && <Badge variant={action.variant}>{action.label}</Badge>}
                </div>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
              {address && (
                <div className="mt-2 rounded border border-dashed border-muted-foreground/30 bg-muted/30 p-2 text-xs">
                  <p className="font-medium">Agent reply</p>
                  <p className="mt-0.5 text-muted-foreground">{address.note}</p>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
