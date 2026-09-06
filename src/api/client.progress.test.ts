import { afterEach, expect, it, vi } from "vitest";
import { subscribeSolverProgress } from "./client";

afterEach(() => vi.unstubAllGlobals());

it("allows native reconnect after a disconnect and closes only on cleanup", () => {
  vi.stubGlobal("localStorage", { getItem: () => "test-token" });
  const close = vi.fn();
  let source: { onmessage?: (e: { data: string }) => void; onerror?: (e: Event) => void } = {};
  vi.stubGlobal("EventSource", class {
    onmessage?: (e: { data: string }) => void;
    onerror?: (e: Event) => void;
    close = close;
    constructor() { source = this; }
  });
  const onEvent = vi.fn();
  const onError = vi.fn();
  const stop = subscribeSolverProgress(onEvent, onError);
  source.onerror?.(new Event("error"));
  expect(onError).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  source.onmessage?.({ data: JSON.stringify({ event: "connected", data: {} }) });
  expect(onEvent).toHaveBeenCalledWith({ event: "connected", data: {} });
  stop();
  expect(close).toHaveBeenCalledOnce();
});
