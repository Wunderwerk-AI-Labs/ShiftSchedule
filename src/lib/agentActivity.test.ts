import { describe, expect, it } from "vitest";
import type { AgentActivityData } from "../api/client";
import { appendAgentEvent, deriveAgentStatus, describeToolUse, formatFeedDate } from "./agentActivity";

const base = { max_iterations: 20, moves_accepted: 0, time_ms: 0 };

function event(partial: Partial<AgentActivityData> & { kind: AgentActivityData["kind"] }): AgentActivityData {
  return { iteration: 0, ...base, ...partial };
}

describe("deriveAgentStatus", () => {
  it("starts in the seed stage with an empty feed", () => {
    const status = deriveAgentStatus([]);
    expect(status.stage).toBe("seed");
    expect(status.feed).toEqual([]);
    expect(status.thinking).toBe(false);
  });

  it("tracks stage transitions and iteration progress", () => {
    const status = deriveAgentStatus([
      event({ kind: "stage", stage: "seed" }),
      event({ kind: "stage", stage: "improve" }),
      event({ kind: "iteration", iteration: 3, moves_accepted: 2 }),
    ]);
    expect(status.stage).toBe("improve");
    expect(status.iteration).toBe(3);
    expect(status.maxIterations).toBe(20);
    expect(status.movesAccepted).toBe(2);
    // Last signal is an iteration tick -> the LLM is working
    expect(status.thinking).toBe(true);
  });

  it("stops the thinking indicator once activity arrives", () => {
    const status = deriveAgentStatus([
      event({ kind: "stage", stage: "improve" }),
      event({ kind: "iteration", iteration: 1 }),
      event({
        kind: "moves_applied",
        iteration: 1,
        improved: true,
        moves: [
          { action: "assign", clinician: "Dr. Alice", section: "MRI", dateISO: "2026-01-05", start: "08:00", end: "16:00" },
        ],
      }),
    ]);
    expect(status.thinking).toBe(false);
    expect(status.feed).toHaveLength(1);
    expect(status.feed[0]).toMatchObject({ type: "move", improved: true });
  });

  it("marks reasoning thoughts so the feed can label the chain of thought", () => {
    const status = deriveAgentStatus([
      event({ kind: "thought", text: "Let me check the open slots.", reasoning: true }),
      event({ kind: "thought", text: "Assigning A to CT." }),
    ]);
    const thoughts = status.feed.filter((entry) => entry.type === "thought");
    expect(thoughts).toHaveLength(2);
    // chronological: newest at the bottom (readers are never yanked around)
    expect(thoughts[0]).toMatchObject({ text: "Let me check the open slots.", reasoning: true });
    expect(thoughts[1]).toMatchObject({ text: "Assigning A to CT.", reasoning: false });
  });

  it("builds a chronological feed from moves, thoughts, and rejections", () => {
    const status = deriveAgentStatus([
      event({ kind: "thought", text: "Filling Monday gaps first." }),
      event({
        kind: "moves_applied",
        moves: [
          { action: "assign", clinician: "A", section: "CT", dateISO: "2026-01-05", start: "08:00", end: "12:00" },
          { action: "unassign", clinician: "B", section: "CT", dateISO: "2026-01-05", start: "08:00", end: "12:00" },
        ],
      }),
      event({ kind: "moves_rejected", count: 2, reason: "would violate OVERLAP" }),
    ]);
    expect(status.feed.map((entry) => entry.type)).toEqual([
      "thought",
      "move",
      "move",
      "rejected",
    ]);
    expect(status.feed[3]).toMatchObject({ count: 2, reason: "would violate OVERLAP" });
  });

  it("caps the feed length to the most recent entries", () => {
    const events = Array.from({ length: 130 }, (_, i) =>
      event({ kind: "thought", text: `t${i}`, time_ms: i }),
    );
    const status = deriveAgentStatus(events);
    expect(status.feed).toHaveLength(100);
    // Newest at the bottom, oldest surviving entry first
    expect(status.feed[0]).toMatchObject({ text: "t30" });
    expect(status.feed[99]).toMatchObject({ text: "t129" });
  });

  it("keeps stage and row identities after hundreds of events from an older server", () => {
    let events = appendAgentEvent([], event({ kind: "stage", stage: "improve" }));
    for (let i = 0; i < 500; i++) events = appendAgentEvent(events, event({ kind: "thought", text: `t${i}`, iteration: i }));
    const before = deriveAgentStatus(events);
    events = appendAgentEvent(events, event({ kind: "iteration", iteration: 501, time_ms: 120000 }));
    const after = deriveAgentStatus(events);
    expect(events).toHaveLength(240);
    expect(after.stage).toBe("improve");
    expect(after.thinking).toBe(true);
    expect(after.actionStartedMs).toBe(120000);
    expect(after.feed.at(-1)?.key).toBe(before.feed.at(-1)?.key);
  });

  it("shows a nested search while it runs, then returns to its parent operation", () => {
    const events = [
      event({ kind: "tool_start", tool: "apply_proposal", activity_id: 1, iteration: 3, time_ms: 1000 }),
      event({ kind: "tool_start", tool: "suggest_day_blocks", activity_id: 2, time_ms: 2000 }),
    ];
    expect(deriveAgentStatus(events).currentAction).toMatch(/Comparing contiguous/);
    events.push(event({ kind: "tool_result", tool: "suggest_day_blocks", activity_id: 2, summary: "More options remain unchecked", outcome: "warning" }));
    expect(deriveAgentStatus(events).currentAction).toMatch(/Applying a checked proposal/);
    events.push(event({ kind: "tool_result", tool: "apply_proposal", activity_id: 1 }));
    expect(deriveAgentStatus(events).currentAction).toBe("Checking the next planning step");
    expect(deriveAgentStatus(events).feed[0]).toMatchObject({ outcome: "warning", summary: "More options remain unchecked" });
  });

  it("restores planning context from a single event after reconnect and shows retries", () => {
    const status = deriveAgentStatus([event({ kind: "retry", stage: "improve", attempt: 2,
      phase_label: "Build the daily plan", planning_date: "2026-01-06", day_index: 2, total_days: 5 })]);
    expect(status.currentAction).toBe("Retrying the model request");
    expect(status.dayIndex).toBe(2);
    expect(status.planningDate).toBe("2026-01-06");
    expect(status.feed[0]).toMatchObject({ type: "notice", warning: true });
  });

  it("shows final review tool receipts without duplicate legacy batch rows", () => {
    const status = deriveAgentStatus([
      event({ kind: "tool_start", tool: "suggest_balance_moves", activity_id: 1, iteration: 4 }),
      event({ kind: "tool_result", tool: "suggest_balance_moves", activity_id: 1, iteration: 4, summary: "No option found in this search." }),
      event({ kind: "tool_use", tools: ["suggest_balance_moves"], iteration: 4 }),
    ]);
    expect(status.feed).toHaveLength(1);
    expect(status.lastResult).toBe("No option found in this search.");
  });
});

describe("formatFeedDate", () => {
  it("formats ISO dates as short weekday + DD.MM.", () => {
    expect(formatFeedDate("2026-01-05")).toBe("Mon 05.01.");
    expect(formatFeedDate("2026-01-11")).toBe("Sun 11.01.");
  });

  it("passes through malformed input", () => {
    expect(formatFeedDate("not-a-date")).toBe("not-a-date");
  });
});

describe("tool_use feed entries", () => {
  it("describes inspection tools in plain language and skips apply_moves", () => {
    expect(
      describeToolUse(["get_plan_overview", "apply_moves", "list_candidates_for_slot"]),
    ).toBe("reviewed the plan status · compared candidates for a slot");
    expect(describeToolUse(undefined)).toBe("");
  });

  it("derives a tools feed row from tool_use events", () => {
    const status = deriveAgentStatus([
      { kind: "stage", stage: "improve", iteration: 0, max_iterations: 20, moves_accepted: 0, time_ms: 0 },
      { kind: "tool_use", tools: ["list_open_slots"], iteration: 1, max_iterations: 20, moves_accepted: 0, time_ms: 100 },
    ]);
    expect(status.feed[0]).toMatchObject({ type: "tools", label: "scanned for open slots" });
  });
});
