import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Chip,
  Mono,
  Notice,
  PageTitle,
  Scroller,
  SectionTitle,
  Td,
  Th,
  relativeDate,
} from '@/components/atoms';
import { FrontierTable, NothingOwed, WorkUnavailable, Who } from '@/components/work';
import { fetchSpecsToday } from '@/lib/api';
import { fetchToday } from '@/lib/work';
import type { SpecsToday } from '@/lib/types';
import type { Today } from '@/lib/work-types';

export const dynamic = 'force-dynamic';

/**
 * Today: only what needs this person, in order of who can do it (ux.md rule 1), and the landing of
 * the console (ADR-0023). Nothing on it is a feed.
 *
 * **Decide** and **Answer** are specs-service's: a version only this person may decide on, and a
 * question nobody has answered on a version they proposed. **Owed** and **Agents at work** are
 * work-service's, and a row there carries why it is here — "escalated to you, step 3 of 5",
 * "breached resolve by" — because in the MVP this page is how maestro alerts. Each half is read on
 * its own, and one service being down leaves the other half standing.
 */
export default async function TodayPage() {
  const [specs, work] = await Promise.allSettled([fetchSpecsToday(), fetchToday()]);
  const me =
    work.status === 'fulfilled'
      ? work.value.principal
      : specs.status === 'fulfilled'
        ? specs.value.principal
        : '';

  return (
    <>
      <div className="flex flex-col gap-1">
        <PageTitle>Today</PageTitle>
        <p className="text-sm text-muted">What needs you, in order of who can do it. Nothing else.</p>
      </div>

      {specs.status === 'fulfilled' ? (
        <SpecsHalf today={specs.value} me={me} />
      ) : (
        <Notice tone="warn" title="Decisions and questions are not available">
          specs-service could not be read, so what waits on your decision is not shown.
        </Notice>
      )}

      {work.status === 'fulfilled' ? (
        <WorkHalf today={work.value} me={me} />
      ) : (
        <WorkUnavailable error={work.reason} />
      )}
    </>
  );
}

function SpecsHalf({ today, me }: { today: SpecsToday; me: string }) {
  return (
    <>
      <Section title="Decide" note="Only you, or someone holding your role, can take these. Oldest first.">
        {today.decide.length === 0 ? (
          <NothingOwed title="Nothing waits on your decision." />
        ) : (
          <Scroller>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Asked of you</Th>
                  <Th>Proposed by</Th>
                  <Th>Ready</Th>
                  <Th right>Proposed</Th>
                </tr>
              </thead>
              <tbody>
                {today.decide.map((d) => (
                  <tr key={`${d.gate}/${d.artifact}/${d.ordinal}`} className="hover:bg-surface-2">
                    <Td>
                      <Link
                        href={`/gates/${d.gate}/${d.artifact}/${d.ordinal}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {d.gate_title}: {d.title}
                      </Link>
                      <span className="flex gap-1.5 pt-0.5 text-2xs text-faint">
                        <span>{d.type_title}</span>
                        <Mono>
                          {d.artifact}@{d.ordinal}
                        </Mono>
                      </span>
                    </Td>
                    <Td>
                      <Who id={d.proposed_by} me={me} />
                    </Td>
                    <Td>
                      {d.open ? (
                        <Chip state="accepted">Ready to decide</Chip>
                      ) : (
                        <span className="flex flex-col gap-0.5">
                          <Chip state="lapsed">Waiting</Chip>
                          <span className="text-2xs text-muted">{d.waiting_on.join(' · ')}</span>
                        </span>
                      )}
                    </Td>
                    <Td right className="text-sm text-muted">
                      {relativeDate(d.proposed_at)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>
        )}
      </Section>

      {today.answer.length > 0 ? (
        <Section
          title="Answer"
          note="Questions on versions you proposed, not yet answered. The asker closes each once answered."
        >
          <ul className="flex flex-col">
            {today.answer.map((a) => (
              <li key={a.question} className="border-b border-rule py-2">
                <Link
                  href={`/artifacts/${a.artifact}/versions/${a.ordinal}`}
                  className="text-sm font-medium underline-offset-2 hover:underline"
                >
                  “{a.text}”
                </Link>
                <span className="flex flex-wrap items-center gap-1.5 pt-0.5 text-2xs text-faint">
                  <span>on {a.title}</span>
                  <Mono>
                    {a.artifact}@{a.ordinal}
                  </Mono>
                  <span>· asked by</span>
                  <Who id={a.asked_by} me={me} />
                  <span>· {relativeDate(a.asked_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

function WorkHalf({ today, me }: { today: Today; me: string }) {
  return (
    <>
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

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
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
