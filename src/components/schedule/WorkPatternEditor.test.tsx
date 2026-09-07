import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { WorkPattern } from "../../api/client";
import { normalizeWorkPattern } from "../../lib/clinicianPreferences";
import WorkPatternEditor from "./WorkPatternEditor";

describe("personal work patterns", () => {
  it("edits independent preferences and allows clearing all of them", () => {
    function Editor() {
      const [value, setValue] = useState<WorkPattern>();
      return <><WorkPatternEditor value={value} onChange={setValue} />
        <output data-testid="saved">{JSON.stringify(value ?? null)}</output></>;
    }
    render(<Editor />);
    const days = screen.getByLabelText("Workdays per week");
    fireEvent.change(days, { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("Fri"));
    expect(JSON.parse(screen.getByTestId("saved").textContent!)).toEqual({ daysPerWeek: 2, preferredDaysOff: ["fri"] });
    fireEvent.change(days, { target: { value: "" } });
    expect(screen.getByLabelText("Fri")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Fri"));
    expect(screen.getByTestId("saved").textContent).toBe("null");
  });

  it("sanitizes imported non-finite values and keeps valid preferences", () => {
    expect(normalizeWorkPattern({ daysPerWeek: Infinity, dailyHours: 8, preferredDaysOff: ["mon", "mon"] }))
      .toEqual({ daysPerWeek: undefined, dailyHours: 8, preferredDaysOff: ["mon"] });
    expect(normalizeWorkPattern({ daysPerWeek: 9, dailyHours: -1 })).toBeUndefined();
  });
});

it('keeps an explicit zero tolerance during save and import', () => {
  expect(normalizeWorkPattern({ dailyHours: 8, dailyHoursTolerance: 0 }))
    .toEqual({ daysPerWeek: undefined, dailyHours: 8, dailyHoursTolerance: 0, preferredDaysOff: [] });
  expect(normalizeWorkPattern({ dailyHoursTolerance: -1 })).toBeUndefined();
  const changed = vi.fn();
  render(<WorkPatternEditor value={{ dailyHours: 8 }} onChange={changed} />);
  fireEvent.change(screen.getByLabelText('Daily hours tolerance (±)'), { target: { value: '0' } });
  expect(changed.mock.calls[0][0].dailyHoursTolerance).toBe(0);
});

it('explains inconsistent weekly and daily wishes without imposing an availability rule', () => {
  render(<WorkPatternEditor value={{ dailyHours: 8, daysPerWeek: 2.5 }} contractHours={40} onChange={() => {}} />);
  expect(screen.getByText(/This pattern totals 20 h\/week/)).toBeVisible();
});
