import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cx } from "../../lib/classNames";
import type { ColorOption } from "../../lib/colorPalette";

type ColorPickerPopoverProps = {
  value?: string | null;
  onChange: (value: string | null) => void;
  options: ColorOption[];
  label?: string;
  disabled?: boolean;
  closeOnSelect?: boolean;
  showCustomInput?: boolean;
  allowClear?: boolean;
  buttonClassName?: string;
  swatchClassName?: string;
  popoverClassName?: string;
};

const normalizeHexColor = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(value)) return null;
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : value;
  return `#${expanded.toUpperCase()}`;
};

export default function ColorPickerPopover({
  value,
  onChange,
  options,
  label = "Select color",
  disabled = false,
  closeOnSelect = true,
  showCustomInput = true,
  allowClear = true,
  buttonClassName,
  swatchClassName,
  popoverClassName,
}: ColorPickerPopoverProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [draft, setDraft] = useState(value ?? "");
  const [inputError, setInputError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(value ?? "");
    setInputError(false);
  }, [isOpen, value]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPosition(null);
      return;
    }
    const button = buttonRef.current;
    const panel = popoverRef.current;
    if (!button || !panel) return;

    const calculatePosition = () => {
      const rect = button.getBoundingClientRect();
      const padding = 8;

      const panelRect = panel.getBoundingClientRect();
      const width = Math.max(panelRect.width, panel.offsetWidth, 120);
      const height = Math.max(panelRect.height, panel.offsetHeight, 100);

      // Calculate available space above and below the button
      const spaceBelow = window.innerHeight - rect.bottom - padding;
      const spaceAbove = rect.top - padding;

      const canFitBelow = spaceBelow >= height;
      const canFitAbove = spaceAbove >= height;
      const openAbove = canFitAbove && !canFitBelow
        ? true
        : !canFitAbove && canFitBelow
          ? false
          : spaceAbove > spaceBelow;
      let nextTop = openAbove
        ? rect.top - height - padding
        : rect.bottom + padding;

      // Horizontal positioning - prefer left-aligned with button
      let nextLeft = rect.left;
      if (nextLeft + width + padding > window.innerWidth) {
        nextLeft = window.innerWidth - width - padding;
      }

      // Ensure popover stays within viewport bounds
      nextLeft = Math.max(padding, Math.min(nextLeft, window.innerWidth - width - padding));
      nextTop = Math.max(padding, Math.min(nextTop, window.innerHeight - height - padding));

      setPosition({ top: nextTop, left: nextLeft });
    };

    // Calculate immediately, then again after a frame to get accurate dimensions
    calculatePosition();
    let rafId2: number | null = null;
    const rafId = requestAnimationFrame(() => {
      calculatePosition();
      rafId2 = requestAnimationFrame(calculatePosition);
    });

    // Reposition on scroll or resize
    const handleRepositionOrClose = () => {
      // Close on scroll to avoid stale positioning in scrollable containers
      setIsOpen(false);
    };

    window.addEventListener("scroll", handleRepositionOrClose, true);
    window.addEventListener("resize", calculatePosition);

    return () => {
      cancelAnimationFrame(rafId);
      if (rafId2 !== null) {
        cancelAnimationFrame(rafId2);
      }
      window.removeEventListener("scroll", handleRepositionOrClose, true);
      window.removeEventListener("resize", calculatePosition);
    };
  }, [isOpen, options.length]);

  const hasValue = Boolean(value);
  const displaySwatch = value ?? "";

  const palette = useMemo(() => options, [options]);

  const applyValue = (next: string | null) => {
    onChange(next);
    if (closeOnSelect) {
      setIsOpen(false);
    }
  };

  const commitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      if (allowClear) {
        setInputError(false);
        applyValue(null);
      } else {
        setDraft(value ?? "");
        setInputError(false);
      }
      return;
    }
    const normalized = normalizeHexColor(trimmed);
    if (!normalized) {
      setInputError(true);
      setDraft(value ?? "");
      return;
    }
    setInputError(false);
    applyValue(normalized);
  };

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          if (disabled) return;
          setIsOpen((prev) => !prev);
        }}
        className={cx(
          "flex items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm",
          "dark:border-slate-700 dark:bg-slate-900",
          disabled && "cursor-not-allowed opacity-60",
          buttonClassName,
        )}
      >
        <span
          className={cx(
            "rounded-full",
            !hasValue && "border border-slate-300",
            swatchClassName,
          )}
          style={hasValue ? { backgroundColor: displaySwatch } : undefined}
        />
      </button>

      {isOpen ? (
        <div
          ref={popoverRef}
          className={cx(
            "fixed z-50 rounded-lg border border-slate-200 bg-white p-2 text-[10px] shadow-lg",
            "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
            popoverClassName,
          )}
          style={{
            ...position,
            // Hide until position is calculated to prevent flash
            visibility: position ? "visible" : "hidden",
          }}
        >
          <div className="grid grid-cols-4 gap-1">
            {palette.map((option) => (
              <button
                key={option.id}
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
                onClick={() => applyValue(option.color)}
                aria-label={option.color ? `Set color ${option.color}` : "Clear color"}
              >
                <span
                  className={cx(
                    "h-3 w-3 rounded-full",
                    option.color === null && "border border-slate-300",
                  )}
                  style={option.color ? { backgroundColor: option.color } : undefined}
                />
              </button>
            ))}
          </div>
          {showCustomInput ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-300">
                Custom
              </span>
              <input
                type="color"
                value={value || "#ffffff"}
                onChange={(event) => {
                  const normalized = normalizeHexColor(event.target.value);
                  if (normalized) {
                    applyValue(normalized);
                  }
                }}
                className="h-6 w-6 cursor-pointer rounded border border-slate-200 bg-transparent p-0 dark:border-slate-700"
                aria-label="Pick a custom color"
              />
              <input
                type="text"
                inputMode="text"
                spellCheck={false}
                placeholder="#RRGGBB"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commitDraft}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitDraft();
                  }
                }}
                className={cx(
                  "w-20 rounded border px-2 py-1 text-[10px] text-slate-700",
                  "border-slate-200 bg-white",
                  "dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                  inputError && "border-rose-400 dark:border-rose-500",
                )}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
