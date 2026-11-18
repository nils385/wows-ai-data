// Loads WoWs ShipBuilder's public game data (https://cdn.wowssb.com), verifying every file's SHA-256 checksum.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const CATEGORIES = ["Ship", "Summary", "Projectile", "Aircraft", "Ability", "Modernization", "Crew", "Exterior"];

export async function loadGameData({ server = "live", dataDir = null } = {}) {
  const cdn = `https://cdn.wowssb.com/api/${server}`;
  const get = async (rel) => {
    if (dataDir) return readFile(path.join(dataDir, rel), "utf8");
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(`${cdn}/${rel}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } catch (e) {
        if (attempt >= 4) throw new Error(`download ${rel} failed: ${e.message}`);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  };
  const version = JSON.parse(await get("VersionInfo.json"));
  const files = {};
  for (const cat of CATEGORIES) {
    files[cat] = {};
    await Promise.all((version.categories[cat] ?? []).map(async (f) => {
      const text = await get(`${cat}/${f.fileName}`);
      if (createHash("sha256").update(text).digest("hex") !== f.checksum) throw new Error(`checksum mismatch: ${cat}/${f.fileName}`);
      files[cat][f.fileName] = JSON.parse(text);
    }));
  }
  const merge = (cat) => Object.assign({}, ...Object.values(files[cat]));
  const L = JSON.parse(await get("Localization/en.json"));
  const ships = merge("Ship");
  return {
    version,
    gameVersion: `${version.currentVersion.mainVersion}.${version.currentVersion.dataIteration}`,
    ships,
    summary: Object.values(files.Summary).flat(),
    projectiles: merge("Projectile"),
    aircraft: merge("Aircraft"),
    abilities: merge("Ability"),
    modernizations: merge("Modernization"),
    captains: files.Crew,
    exteriors: merge("Exterior"),
    L,
    name: (key) => (key ? L[String(key).toUpperCase()] ?? null : null),
  };
}
