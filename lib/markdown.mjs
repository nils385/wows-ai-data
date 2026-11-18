// Generic JSON -> Markdown renderer. Keeps every value; arrays of similar objects become tables.

const fmt = (v) => {
  if (v === null || v === undefined) return "n/a";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.map(fmt).join(", ");
  return String(v).replace(/\|/g, "\\|").replace(/\s*\n+\s*/g, " ");
};
const isScalar = (v) => v === null || v === undefined || typeof v !== "object" || (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object"));
const label = (k) => String(k).replace(/_/g, " ");

export function toMarkdown(obj, depth = 2) {
  const lines = [];
  render(obj, depth, lines);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function render(obj, depth, lines) {
  if (obj === null || obj === undefined) return;
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  const scalars = entries.filter(([, v]) => isScalar(v));
  if (scalars.length) {
    lines.push("| field | value |", "|---|---|");
    for (const [k, v] of scalars) lines.push(`| ${label(k)} | ${fmt(v)} |`);
    lines.push("");
  }
  for (const [k, v] of entries) {
    if (isScalar(v)) continue;
    const h = "#".repeat(Math.min(depth, 6));
    if (Array.isArray(v)) {
      if (!v.length) continue;
      lines.push(`${h} ${label(k)}`, "");
      const flatRows = v.every((x) => x && typeof x === "object" && !Array.isArray(x) && Object.values(x).every(isScalar));
      if (flatRows) {
        const cols = [...new Set(v.flatMap((x) => Object.keys(x)))];
        lines.push(`| ${cols.map(label).join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`);
        for (const x of v) lines.push(`| ${cols.map((c) => fmt(x[c])).join(" | ")} |`);
        lines.push("");
      } else {
        v.forEach((x, i) => {
          lines.push(`${"#".repeat(Math.min(depth + 1, 6))} ${label(k)} ${i + 1}${x?.name ? `: ${fmt(x.name)}` : ""}`, "");
          if (x && typeof x === "object") render(x, depth + 2, lines); else lines.push(fmt(x), "");
        });
      }
      continue;
    }
    lines.push(`${h} ${label(k)}`, "");
    render(v, depth + 1, lines);
  }
}
