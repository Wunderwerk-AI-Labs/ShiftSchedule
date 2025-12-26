import { readdirSync, readFileSync, statSync } from "fs";
import { extname, join } from "path";

const ROOT = process.cwd();
const TARGET_DIRS = ["src"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORE_BORDER_TOKENS = new Set([
  "border",
  "border-0",
  "border-2",
  "border-4",
  "border-8",
  "border-x",
  "border-y",
  "border-t",
  "border-b",
  "border-l",
  "border-r",
  "border-solid",
  "border-dashed",
  "border-dotted",
  "border-double",
  "border-none",
]);

const findings = [];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, files);
    } else if (EXTENSIONS.has(extname(fullPath))) {
      files.push(fullPath);
    }
  }
  return files;
}

function getLineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function extractStringLiterals(text) {
  const regex = /(["'`])((?:\\\1|.)*?)\1/gm;
  const literals = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const quote = match[1];
    const value = match[2];
    if (quote === "`" && value.includes("${")) continue;
    literals.push({ value, index: match.index });
  }
  return literals;
}

function collectUnprefixedTokens(tokens, prefix, filterFn) {
  return tokens.filter((token) => {
    if (!token.startsWith(prefix)) return false;
    if (token.includes(":")) return false;
    return filterFn ? filterFn(token) : true;
  });
}

for (const dir of TARGET_DIRS) {
  const fullDir = join(ROOT, dir);
  for (const file of walk(fullDir)) {
    const text = readFileSync(file, "utf8");
    const literals = extractStringLiterals(text);
    for (const literal of literals) {
      if (!literal.value.includes("bg-") && !literal.value.includes("border-")) {
        continue;
      }
      const tokens = literal.value.split(/\s+/).filter(Boolean);
      const bgTokens = collectUnprefixedTokens(tokens, "bg-");
      const borderTokens = collectUnprefixedTokens(tokens, "border-", (token) => {
        if (IGNORE_BORDER_TOKENS.has(token)) return false;
        if (/^border-\d/.test(token)) return false;
        if (/^border-(?:t|b|l|r|x|y)-\d+$/.test(token)) return false;
        return true;
      });
      const uniqueBg = new Set(bgTokens);
      const uniqueBorder = new Set(borderTokens);
      if (uniqueBg.size > 1 || uniqueBorder.size > 1) {
        findings.push({
          file,
          line: getLineNumber(text, literal.index),
          bg: [...uniqueBg],
          border: [...uniqueBorder],
        });
      }
    }
  }
}

if (findings.length > 0) {
  console.log("Potential Tailwind color conflicts (multiple base classes):");
  for (const finding of findings) {
    const parts = [];
    if (finding.bg.length > 1) parts.push(`bg: ${finding.bg.join(", ")}`);
    if (finding.border.length > 1) parts.push(`border: ${finding.border.join(", ")}`);
    console.log(`- ${finding.file}:${finding.line} (${parts.join(" | ")})`);
  }
  process.exit(1);
}

console.log("No base Tailwind color conflicts found.");
