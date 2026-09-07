import { buttonAssignmentLock } from "../../lib/buttonStyles";

export default function AssignmentLockButton({ name, locked, onToggle }: {
  name: string; locked: boolean; onToggle: () => void;
}) {
  const label = `${locked ? "Unfix" : "Fix"} assignment for ${name}`;
  return <button type="button" className={buttonAssignmentLock} aria-label={label}
    aria-pressed={locked} title={locked ? "Fixed: kept during replanning and reset. Click to unfix." : "Fix this assignment before replanning"}
    draggable={false} onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
    onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}
    onClick={event => { event.stopPropagation(); onToggle(); }}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="5" y="10" width="14" height="11" rx="2" />
      {locked ? <path d="M8 10V6a4 4 0 0 1 8 0v4" /> : <path d="M8 10V6a4 4 0 0 1 8 0" />}
    </svg>
  </button>;
}
