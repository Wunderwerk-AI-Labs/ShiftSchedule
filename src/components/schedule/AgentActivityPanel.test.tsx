import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AgentActivityPanel from "./AgentActivityPanel";
import type { AgentActivityData } from "../../api/client";

// Distinct start/end markers so we can prove the WHOLE text is shown, not a
// clamped preview. ~1700 chars, well past THOUGHT_PREVIEW_CHARS (220).
const LONG =
  "START-MARKER " + "reasoning detail ".repeat(100) + "END-MARKER";

function ev(data: Partial<AgentActivityData>): AgentActivityData {
  return {
    kind: "thought",
    iteration: 1,
    max_iterations: 20,
    moves_accepted: 0,
    time_ms: 0,
    ...data,
  } as AgentActivityData;
}

describe("AgentActivityPanel full-text dialog", () => {
  it("opens the complete reasoning in a dialog, not just a clamped preview", () => {
    render(
      <AgentActivityPanel
        events={[
          ev({ kind: "stage", stage: "improve" }),
          ev({ kind: "thought", text: LONG, reasoning: true }),
        ]}
      />,
    );
    // The feed preview shows the start but is clamped before the end marker.
    fireEvent.click(screen.getByRole("checkbox", { name: "Include model text" }));
    expect(screen.queryByText(/END-MARKER/)).toBeNull();
    const opener = screen.getByRole("button", { name: /show full text/i });
    fireEvent.click(opener);
    // The dialog now shows the COMPLETE text — both markers are present.
    const dialogBody = screen.getByText(
      (_content, node) =>
        node?.tagName === "PRE" &&
        (node.textContent ?? "").includes("START-MARKER") &&
        (node.textContent ?? "").includes("END-MARKER"),
    );
    expect(dialogBody).toBeTruthy();
    expect(screen.getByText(/reasoning \(full text\)/i)).toBeTruthy();
    // Escape closes it.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText(/END-MARKER/)).toBeNull();
  });

  it("keeps short thoughts inline without an opener", () => {
    render(
      <AgentActivityPanel
        events={[
          ev({ kind: "stage", stage: "improve" }),
          ev({ kind: "thought", text: "Filling Monday gaps." }),
        ]}
      />,
    );
    expect(screen.queryByText("Filling Monday gaps.")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include model text" }));
    expect(screen.getByText("Filling Monday gaps.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /show full text/i })).toBeNull();
  });
});

it("keeps the current day and operation visible with an honest waiting duration", () => {
  const events = [ev({ kind: "tool_start", stage: "improve", tool: "suggest_rescue_moves", activity_id: 7,
    phase_label: "Build the daily plan", planning_date: "2026-01-06", day_index: 2, total_days: 5, time_ms: 60000 })];
  const { rerender } = render(<AgentActivityPanel events={events} elapsedMs={75000} />);
  expect(screen.getByText(/Day 2 of 5 · Tue 06.01./)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Searching for swaps");
  expect(screen.getByText("0:15 in this step")).toBeTruthy();
  rerender(<AgentActivityPanel events={events} elapsedMs={75000} liveConnected={false} />);
  expect(screen.getByRole("status").textContent).toBe("Live updates interrupted");
  expect(screen.getByText(/this view may be out of date/)).toBeTruthy();
});

it("distinguishes temporary working changes from a better saved plan", () => {
  render(<AgentActivityPanel events={[ev({ kind: "moves_applied", retained_best: false, improved: false,
    moves: [{ action: "assign", clinician: "Dr. Schmit", section: "MRI", dateISO: "2026-01-06", start: "08:00", end: "16:00" }] })]} />);
  const feed = screen.getByRole("region", { name: "Planning activity" });
  expect(within(feed).getByText(/earlier best kept/)).toBeTruthy();
  expect(within(feed).queryByText(/Better plan saved/)).toBeNull();
});
