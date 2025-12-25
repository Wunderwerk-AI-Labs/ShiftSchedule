import { useState } from "react";
import { cx } from "../../lib/classNames";

type TopBarProps = {
  openSlotsCount: number;
  viewMode: "calendar" | "settings";
  onToggleView: () => void;
  activeUserId: string;
  users: Array<{ id: string; label: string }>;
  onSelectUser: (userId: string) => void;
};

export default function TopBar({
  openSlotsCount,
  viewMode,
  onToggleView,
  activeUserId,
  users,
  onSelectUser,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const activeUser = users.find((user) => user.id === activeUserId) ?? users[0];
  return (
    <div className="relative border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Weekly Schedule
          </h1>
          {viewMode === "calendar" ? (
            <span className="inline-flex items-center rounded-full bg-rose-50 px-3 py-1 text-sm font-medium text-rose-600 ring-1 ring-inset ring-rose-200">
              {openSlotsCount} Open Slots
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleView}
            className={cx(
              "inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm",
              "hover:bg-slate-50 active:bg-slate-100",
            )}
          >
            {viewMode === "calendar" ? "Settings" : "Back to Schedule"}
          </button>
        </div>
      </div>
      <div className="absolute right-6 top-5">
        <button
          type="button"
          aria-label="Account"
          onClick={() => setMenuOpen((open) => !open)}
          className={cx(
            "grid h-10 w-10 place-items-center rounded-full bg-sky-500 text-sm font-semibold text-white shadow-sm",
            "hover:bg-sky-600 active:bg-sky-700",
          )}
        >
          {activeUser?.label ?? "JK"}
        </button>
        {menuOpen ? (
          <div className="absolute right-0 mt-2 w-28 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => {
                  onSelectUser(user.id);
                  setMenuOpen(false);
                }}
                className={cx(
                  "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold",
                  user.id === activeUserId
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                <span>{user.label}</span>
                {user.id === activeUserId ? <span>✓</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
