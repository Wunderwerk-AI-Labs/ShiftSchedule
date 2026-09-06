"""Bound inspection loops and cycles while allowing multi-step exploration."""
from collections import deque


class ProgressGuard:
    def __init__(self, initial_state, *, nudge_after=6, stop_after=12):
        self.recent = deque([initial_state], maxlen=24)
        self.stale_rounds = 0
        self.nudge_after = nudge_after
        self.stop_after = stop_after

    def observe(self, state):
        self.stale_rounds = self.stale_rounds + 1 if state in self.recent else 0
        self.recent.append(state)
        if self.stale_rounds >= self.stop_after:
            return "stop"
        if self.stale_rounds == self.nudge_after:
            return "nudge"
        return "continue"
