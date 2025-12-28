import type { ReactNode } from "react";
import { cx } from "../../lib/classNames";

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h3>
      <div className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
        {children}
      </div>
    </section>
  );
}

export default function HelpView() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            🩺 Shift Planner – Quick Guide
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Desktop overview of the most important features.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4">
        <Section title="1. Navigate Dates">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Use the left/right arrows above the calendar to move by week.
            </li>
            <li>
              Use <span className="font-medium">Today</span> to jump back to the
              current date.
            </li>
          </ul>
        </Section>

        <Section title="2. Filling the Schedule (Manual & Automated)">
          <p>The schedule can be filled manually or automatically.</p>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            <div className="font-medium">Open Slots & Minimum Staffing</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <span className="font-medium">Open Slots</span> represent the
                minimum required staffing per section/workstation.
              </li>
              <li>
                Minimum slot requirements can be configured globally (weekday vs
                weekend/holiday) and overridden for individual days.
              </li>
              <li>The schedule can be filled beyond the minimum.</li>
            </ul>
          </div>
        </Section>

        <Section title="3. Automated Filling (Solver)">
          <p>
            The solver attempts to allocate people based on eligibility and
            Open Slot requirements, with the goal of filling as many Open Slots
            as possible using available people.
          </p>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Automated planning panel
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
                <li>
                  <span className="font-medium">Fill open slots only</span>:
                  runs the solver without forcing full distribution.
                </li>
                <li>
                  <span className="font-medium">Distribute all people</span>:
                  uses the Distribution Pool to spread assignments.
                </li>
                <li>
                  <span className="font-medium">Reset to Distribution Pool</span>:
                  clears assignments for the selected timeframe.
                </li>
              </ul>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Choose a date range, or use the visible week shortcut.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Pools & solver behavior
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
                <li>
                  <span className="font-medium">Distribution Pool</span>:
                  people here are used for automatic allocation.
                </li>
                <li>
                  <span className="font-medium">Reserve Pool</span>: people
                  here are not considered by the solver.
                </li>
                <li>
                  <span className="font-medium">Vacation Pool</span>: people
                  on vacation are excluded from automatic allocation.
                </li>
              </ul>
            </div>
          </div>
        </Section>

        <Section title="4. Manual Assignment (Drag & Drop)">
          <ul className="list-disc space-y-1 pl-5">
            <li>Drag a person pill from a pool.</li>
            <li>Drop it into a section cell for a specific day.</li>
          </ul>
          <p className="mt-2">
            If a drop is not allowed (e.g. wrong day or ineligible section), the
            person snaps back to the original position.
          </p>
        </Section>

        <Section title="5. Eligibility Highlighting">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              When dragging a person, all eligible cells are highlighted.
            </li>
            <li>
              When hovering over a section/day cell, all eligible people are
              highlighted in green.
            </li>
          </ul>
          <p className="mt-2">Eligibility can be edited in Settings.</p>
        </Section>

        <Section title="6. Managing Open Slots">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Add an Open Slot by clicking an empty section/day cell.
            </li>
            <li>
              Remove an Open Slot using the “–” button on the Open Slot pill.
            </li>
            <li>Slot requirements can also be managed globally or per day in Settings.</li>
          </ul>
        </Section>

        <Section title="7. Vacations">
          <p>
            Vacations remove people from scheduling for their vacation days.
            You can manage vacations in Settings (and in some setups by dragging
            people into/out of the Vacation row).
          </p>
        </Section>

        <Section title="8. Holidays & Weekends">
          <p>Holidays behave like weekends for minimum-slot logic.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Holiday names appear under the date header.
            </li>
            <li>
              Holidays can be preloaded by country and year, and added/removed
              manually (date + name).
            </li>
          </ul>
        </Section>

        <Section title="9. Settings">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="font-medium">Sections</span>: names, order, and
              minimum required slots (weekday vs weekend/holiday).
            </li>
            <li>
              <span className="font-medium">People</span>: add/edit/remove,
              eligible sections, vacations.
            </li>
            <li>
              <span className="font-medium">Holidays</span>: preload, add/remove.
            </li>
          </ul>
        </Section>

        <Section title="10. Auto-Fill Status">
          <p>
            Shift Planner can auto-allocate required slots. If you see “Solver
            service is not responding”, the backend service is not reachable.
          </p>
        </Section>

        <Section title="11. iCal (Download & Subscribe)">
          <p>
            You can download your schedule as an <span className="font-medium">iCal</span>{" "}
            file (<span className="font-medium">.ics</span>) or publish a subscribe link
            for calendar apps (Google Calendar, Apple Calendar, Outlook).
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              A single <span className="font-medium">.ics</span> file can contain{" "}
              <span className="font-medium">multiple events across many dates</span>.
            </li>
            <li>
              In <span className="font-medium">Download</span>, you can export either{" "}
              <span className="font-medium">one file for all people</span> or{" "}
              <span className="font-medium">individual files per person</span>.
            </li>
            <li>
              In <span className="font-medium">Subscribe / Publish</span>, you can publish a
              read-only link (anyone with the link can subscribe), rotate the link, or unpublish it.
            </li>
            <li>
              Subscriptions include only weeks marked{" "}
              <span className="font-medium">Published</span> in the schedule view.
            </li>
            <li>
              When published, you get one link for{" "}
              <span className="font-medium">all people</span> and one link per person.
            </li>
          </ul>
        </Section>
      </div>

      <div
        className={cx(
          "mt-6 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-xs text-slate-500",
          "dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400",
        )}
      >
        Your changes are saved to the server so they remain after reloading the
        page.
      </div>
    </div>
  );
}
