import { PageTitle, SectionTitle } from '@/components/atoms';
import { FrontierTable, NothingOwed, WorkUnavailable } from '@/components/work';
import { fetchToday } from '@/lib/work';
import type { Today } from '@/lib/work-types';

export const dynamic = 'force-dynamic';

/**
 * Today: only what needs this person, in order of who can do it (ux.md rule 1), and the landing of
 * the console (ADR-0023). Nothing on it is a feed.
 *
 * work-service's half is here: what a chase step brought to them, what they owe, and the agents'
 * work they answer for. Each row carries why it is here — "escalated to you, step 3 of 5",
 * "breached resolve by" — because in the MVP this page is how maestro alerts: there is no other
 * channel. specs-service's half, the decisions only this person can take and the questions on what
 * they wrote, joins it from specs-service's own read.
 */
export default async function TodayPage() {
  let today: Today;
  try {
    today = await fetchToday();
  } catch (error) {
    return (
      <>
        <PageTitle>Today</PageTitle>
        <WorkUnavailable error={error} />
      </>
    );
  }
  const me = today.principal;

  return (
    <>
      <div className="flex flex-col gap-1">
        <PageTitle>Today</PageTitle>
        <p className="text-sm text-muted">What needs you, in order of who can do it. Nothing else.</p>
      </div>

      {today.escalated.length > 0 ? (
        <Section
          title="Brought to you"
          note="A chase step reached you on these. You neither hold them nor answer for them; the answerable person has not changed."
        >
          <FrontierTable rows={today.escalated} me={me} empty={null} />
        </Section>
      ) : null}

      <Section title="Owed" note="Items you hold, or answer for with nobody holding them. Soonest first.">
        <FrontierTable rows={today.owes} me={me} empty={<NothingOwed title="You owe nothing right now." />} />
      </Section>

      <Section
        title="Agents at work"
        note="Items an agent holds that you answer for. You are the next person on each, and the answerable one whatever the agent does."
      >
        <FrontierTable
          rows={today.oversees}
          me={me}
          empty={<NothingOwed title="No agent is acting on anything you answer for." />}
        />
      </Section>
    </>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <SectionTitle>{title}</SectionTitle>
        <p className="text-xs text-muted">{note}</p>
      </div>
      {children}
    </section>
  );
}
