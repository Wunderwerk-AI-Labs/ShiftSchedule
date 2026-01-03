import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";

type Violation = {
  id: string;
  assignmentKeys: string[];
};

type ViolationLinesOverlayProps = {
  /** All violations to show lines for */
  violations: Violation[];
  /** Whether lines should be visible */
  visible: boolean;
  /** Container element to scope pill lookups (optional, defaults to document) */
  containerRef?: React.RefObject<HTMLElement>;
};

type PillPosition = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

type Line = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/**
 * Calculate the intersection point of a line from center to target with a rounded rectangle border.
 * This makes lines appear to start/end at the pill edge instead of center.
 */
function getEdgePoint(
  pill: PillPosition,
  targetX: number,
  targetY: number,
): { x: number; y: number } {
  const { centerX, centerY, width, height } = pill;
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  // Direction from pill center to target
  const dx = targetX - centerX;
  const dy = targetY - centerY;

  // Handle case where target is at the same position
  if (dx === 0 && dy === 0) {
    return { x: centerX, y: centerY };
  }

  // Calculate intersection with rectangle edges
  // We'll use parametric form: point = center + t * direction
  let t = Infinity;

  // Check intersection with left/right edges
  if (dx !== 0) {
    const tRight = halfWidth / Math.abs(dx);
    const tLeft = halfWidth / Math.abs(dx);
    t = Math.min(t, dx > 0 ? tRight : tLeft);
  }

  // Check intersection with top/bottom edges
  if (dy !== 0) {
    const tBottom = halfHeight / Math.abs(dy);
    const tTop = halfHeight / Math.abs(dy);
    t = Math.min(t, dy > 0 ? tBottom : tTop);
  }

  // Add small padding to be slightly outside the border
  const padding = 4;
  const paddingT = t + padding / Math.sqrt(dx * dx + dy * dy);

  return {
    x: centerX + dx * paddingT,
    y: centerY + dy * paddingT,
  };
}

/**
 * For each violation, connect all assignment keys in a chain.
 * Sort by position to ensure consistent visual ordering.
 */
function getViolationLines(
  violation: Violation,
  positions: Map<string, PillPosition>,
): Line[] {
  const lines: Line[] = [];
  const keys = violation.assignmentKeys;

  // Get positions for all keys that exist
  const foundPositions: Array<{ key: string; pos: PillPosition }> = [];
  for (const key of keys) {
    const pos = positions.get(key);
    if (pos) {
      foundPositions.push({ key, pos });
    }
  }

  // Need at least 2 pills to draw a line
  if (foundPositions.length < 2) {
    return lines;
  }

  // Sort by vertical position (row) first, then horizontal (date)
  foundPositions.sort((a, b) => {
    if (Math.abs(a.pos.y - b.pos.y) > 10) {
      return a.pos.y - b.pos.y;
    }
    return a.pos.x - b.pos.x;
  });

  // Draw chain: first → second → third → ...
  // This ensures each violation gets at least one line connecting its pills
  for (let i = 0; i < foundPositions.length - 1; i++) {
    const from = foundPositions[i];
    const to = foundPositions[i + 1];

    // Calculate edge points so lines start/end at pill borders
    const fromEdge = getEdgePoint(from.pos, to.pos.centerX, to.pos.centerY);
    const toEdge = getEdgePoint(to.pos, from.pos.centerX, from.pos.centerY);

    lines.push({
      id: `${violation.id}-${i}-${from.key}-${to.key}`,
      x1: fromEdge.x,
      y1: fromEdge.y,
      x2: toEdge.x,
      y2: toEdge.y,
    });
  }

  return lines;
}

export default function ViolationLinesOverlay({
  violations,
  visible,
  containerRef,
}: ViolationLinesOverlayProps) {
  const [lines, setLines] = useState<Line[]>([]);

  const calculateLines = useCallback(() => {
    if (!visible || violations.length === 0) {
      setLines([]);
      return;
    }

    // Collect all unique assignment keys
    const allKeys = new Set<string>();
    for (const violation of violations) {
      for (const key of violation.assignmentKeys) {
        allKeys.add(key);
      }
    }

    // Find all pill elements and their positions
    const container = containerRef?.current ?? document;
    const positions = new Map<string, PillPosition>();

    for (const key of allKeys) {
      const element = container.querySelector(
        `[data-assignment-key="${key}"]`,
      ) as HTMLElement | null;
      if (element) {
        const rect = element.getBoundingClientRect();
        // Use viewport coordinates directly since SVG is fixed positioned
        positions.set(key, {
          key,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        });
      }
    }

    // Calculate lines for each violation
    const newLines: Line[] = [];
    for (const violation of violations) {
      newLines.push(...getViolationLines(violation, positions));
    }

    setLines(newLines);
  }, [visible, violations, containerRef]);

  // Calculate lines on mount and when dependencies change
  useEffect(() => {
    calculateLines();

    // Recalculate on window resize and scroll
    const handleResize = () => calculateLines();
    const handleScroll = () => calculateLines();

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [calculateLines]);

  if (!visible || lines.length === 0) {
    return null;
  }

  return createPortal(
    <svg
      className="pointer-events-none fixed inset-0 z-[999]"
      style={{ width: "100vw", height: "100vh", overflow: "visible" }}
    >
      {lines.map((line) => (
        <line
          key={line.id}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke="#ef4444"
          strokeWidth="2"
          strokeDasharray="6 4"
          strokeLinecap="round"
        />
      ))}
    </svg>,
    document.body,
  );
}
