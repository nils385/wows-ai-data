#!/usr/bin/env bash
# Writes every source file into one text file (for second-opinion reviews). Usage: tools/bundle_code.sh OUT_FILE
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$1"
{
  printf 'PROJECT: wows-ai-data - a static website of World of Warships ship data built for AI agents (not people).\n'
  printf 'Live site: https://nils385.github.io/wows-ai-data/  (start: /llms.txt)\nRepository: https://github.com/nils385/wows-ai-data  (commit %s)\n\n' "$(git rev-parse --short HEAD)"
  printf 'How it works: build.mjs downloads game data from WoWs ShipBuilder (cdn.wowssb.com), computes every stat with a JavaScript port of ShipBuilder formulas (lib/ship.mjs, lib/acceleration.mjs, lib/ballistics.mjs), analyses upgrades/skills/flags (lib/analysis.mjs), flattens stats into metrics for rankings (lib/metrics.mjs), adds glossary/mechanics/tech trees/community pages (lib/knowledge.mjs), renders the player-facing HTML encyclopedia from the same records (lib/site.mjs, lib/pages.mjs), validates every module combination (lib/validate.mjs + build.mjs), builds into dist.staging and swaps to dist only on success (with rollback). GitHub Actions rebuilds and deploys every 6 hours. tools/ holds the wiki cross-check and wiki armor/terminology extractors.\n\n'
  printf 'Known by design: acceleration and integer-modifier code intentionally match ShipBuilder (C#). Deliberate deviation: fighter consumable reload modifiers are applied once (ShipBuilder applies them twice).\n\nPlease review for: correctness of the game formulas, bugs, how easy the output is for AI agents to use, and anything missing.\n'
  for f in README.md .github/workflows/build.yml build.mjs lib/*.mjs lib/*.md tests/*.mjs tools/*.py tools/*.sh; do
    printf '\n\n===== FILE: %s =====\n\n' "$f"; cat "$f"
  done
} > "$OUT"
echo "wrote $OUT ($(wc -c < "$OUT") bytes)"
