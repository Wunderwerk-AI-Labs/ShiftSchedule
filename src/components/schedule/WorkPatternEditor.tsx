import type { WorkPattern } from "../../api/client";
import { normalizeWorkPattern } from "../../lib/clinicianPreferences";

const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export default function WorkPatternEditor({ value, onChange }: {
  value?: WorkPattern;
  onChange: (value?: WorkPattern) => void;
}) {
  const update = (patch: Partial<WorkPattern>) => onChange(normalizeWorkPattern({ ...value, ...patch }));
  return (
    <fieldset className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
      <legend className="px-2 font-semibold">Preferred work pattern</legend>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Optional preferences, not availability limits. Days per week determine the target day length
        from contracted hours; daily hours override that target. The balanced profile also scores preferred days off.
      </p>
      <div className="flex flex-wrap gap-4">
        {([
          ["daysPerWeek", "Workdays per week", 7],
          ["dailyHours", "Hours per working day", 24],
        ] as const).map(([field, label, max]) => (
          <label key={field} className="flex flex-col gap-1">
            {label}
            <input type="number" min={1} max={max} step={0.5}
              value={value?.[field] ?? ""} placeholder="Automatic"
              onChange={event => update({ [field]: event.target.value === "" ? undefined : Number(event.target.value) })}
              className="w-36 rounded-lg border border-slate-200 bg-transparent px-2 py-1 dark:border-slate-700" />
          </label>
        ))}
      </div>
      <div className="mt-3">Prefer these days off</div>
      <div className="mt-2 flex flex-wrap gap-3">
        {days.map(day => (
          <label key={day} className="flex items-center gap-1">
            <input type="checkbox" checked={value?.preferredDaysOff?.includes(day) ?? false}
              onChange={event => update({ preferredDaysOff: event.target.checked
                ? [...(value?.preferredDaysOff ?? []), day]
                : value?.preferredDaysOff?.filter(item => item !== day) })} />
            {day[0].toUpperCase() + day.slice(1)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
