'use server';

import { revalidatePath } from 'next/cache';
import { WorkError, claimItem, linkPullRequest, moveItem, releaseItem, resolveItem } from '@/lib/work';

export interface ActState {
  error?: string;
  notice?: string;
}

/**
 * One act on an item, named by the form's `act`. work-service decides whether the caller may: a
 * refusal comes back as its sentence and is shown as it is, because it is an answer (ux.md rule 8).
 */
export async function act(_: ActState, form: FormData): Promise<ActState> {
  const id = String(form.get('item') ?? '');
  const what = String(form.get('act') ?? '');
  const reason = String(form.get('reason') ?? '').trim();
  try {
    switch (what) {
      case 'claim': {
        const claimed = await claimItem(id);
        if (claimed.result === 'refused') {
          revalidatePath(`/items/${id}`);
          return { error: claimed.sentence };
        }
        break;
      }
      case 'release':
        await releaseItem(id);
        break;
      case 'in_progress':
      case 'blocked':
        await moveItem(id, what);
        break;
      case 'done':
        await resolveItem(id, 'done', reason || undefined);
        break;
      case 'superseded':
      case 'refused':
        if (!reason) return { error: 'Say why. The reason is kept on the item as its closure.' };
        await resolveItem(id, what, reason);
        break;
      case 'link': {
        const pr = String(form.get('pull_request') ?? '').trim();
        if (!pr) return { error: 'Name the pull request as <owner>/<repo>#<number>.' };
        await linkPullRequest(id, pr);
        break;
      }
      default:
        return { error: 'Nothing to do.' };
    }
  } catch (error) {
    return {
      error:
        error instanceof WorkError
          ? error.message
          : 'work-service could not be reached. Nothing was recorded.',
    };
  }
  revalidatePath(`/items/${id}`);
  return {};
}
