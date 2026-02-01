export type ColorOption = {
  id: string;
  color: string | null;
};

export const BLOCK_COLOR_OPTIONS: ColorOption[] = [
  { id: "none", color: null },
  { id: "rose", color: "#FDE2E4" },
  { id: "coral", color: "#FFD9C9" },
  { id: "peach", color: "#FFE8D6" },
  { id: "apricot", color: "#FFEFD1" },
  { id: "butter", color: "#FFF4C1" },
  { id: "lime", color: "#EEF6C8" },
  { id: "mint", color: "#E6F7D9" },
  { id: "seafoam", color: "#DDF6EE" },
  { id: "sky", color: "#D9F0FF" },
  { id: "periwinkle", color: "#DEE8FF" },
  { id: "lavender", color: "#E8E1F5" },
];

export const BLOCK_COLOR_SWATCH_OPTIONS: Array<{ id: string; color: string }> =
  BLOCK_COLOR_OPTIONS.filter(
    (option): option is { id: string; color: string } => !!option.color,
  );
