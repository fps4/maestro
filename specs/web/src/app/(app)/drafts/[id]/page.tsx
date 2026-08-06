import { notFound } from 'next/navigation';
import { fetchDefinition, fetchDraft } from '@/lib/api';
import { currentWorkspace } from '@/lib/auth';
import { Editor } from './editor';

export const dynamic = 'force-dynamic';

/**
 * The draft editor.
 *
 * Everything on this surface is dashed, so the mutable/immutable line is carried by the frame rather
 * than by a label — a reader should never have to infer which of the two things they are looking at.
 */
export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let draft;
  try {
    draft = await fetchDraft(id);
  } catch {
    notFound();
  }

  const workspace = await currentWorkspace();
  const definition = await fetchDefinition().catch(() => null);
  const type = definition?.definition.types.find((t) => t.id === draft.type);
  const gate = definition?.definition.gates.find((g) => g.decides_on === draft.type);

  return (
    <Editor
      workspace={workspace}
      draft={draft}
      requiresConfirmedFacets={gate?.requires.confirmed_facets ?? false}
      gateName={gate?.title ?? gate?.id ?? null}
      pinnedLink={type?.links.find((l) => l.pinned) ?? null}
      classificationRequired={type?.classification_required ?? false}
    />
  );
}
