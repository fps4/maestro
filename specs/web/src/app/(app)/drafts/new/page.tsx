import { redirect } from 'next/navigation';
import { fetchDefinition } from '@/lib/api';
import { currentWorkspace } from '@/lib/auth';
import { Button, Card, Eyebrow, Mono, Notice, PageTitle } from '@/components/atoms';

export const dynamic = 'force-dynamic';

/**
 * Start a draft.
 *
 * The type list comes from the workspace definition, not from a constant — the service ships no
 * vocabulary, so neither does this screen.
 */
export default async function NewDraftPage() {
  const workspace = await currentWorkspace();
  const { definition } = await fetchDefinition();

  async function create(formData: FormData) {
    'use server';
    const { createDraft } = await import('@/lib/actions');
    const id = await createDraft({
      type: String(formData.get('type') ?? ''),
      title: String(formData.get('title') ?? ''),
    });
    redirect(`/drafts/${id}`);
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <Eyebrow>new draft · in {workspace}</Eyebrow>
        <PageTitle>Start a draft</PageTitle>
        <p className="text-sm text-muted">
          A draft is mutable and is not a record. Nothing may cite one, and nothing here is decided until a
          version is proposed and a named human passes it through a gate.
        </p>
      </div>

      <form action={create} className="flex max-w-xl flex-col gap-4">
        <Card className="gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-2xs uppercase tracking-[0.06em] text-faint">Type</span>
            <select
              name="type"
              required
              className="rounded border border-rule-strong bg-surface px-2.5 py-2 text-sm"
            >
              {definition.types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.id.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-2xs uppercase tracking-[0.06em] text-faint">Title</span>
            <input
              name="title"
              required
              minLength={1}
              placeholder="What is this about, in a line"
              className="rounded border border-rule-strong bg-surface px-2.5 py-2 text-sm"
            />
          </label>
        </Card>

        <Button type="submit" variant="primary">
          Create draft
        </Button>
      </form>

      <Notice title="The type decides what this artifact must carry.">
        Facet schema, body format, which links are declared and which one is pinned, whether a classification
        is required at propose — all of it is <Mono>config/workspaces/</Mono>, not code.
      </Notice>
    </>
  );
}
