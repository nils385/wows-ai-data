# WoWs data for AIs

A static website with complete World of Warships ship data, made for AI agents rather than people. It's plain JSON, CSV and Markdown, with units in every field name and an `llms.txt` entry point. It rebuilds itself every day, so new patches show up automatically.

**AI agents: start at `/llms.txt`.**

## What's in it

- **Every ship** (about 950 released, plus test ships kept separate), with **every stat for every module combination**: survivability, hit-location HP, fire and flooding, speed, rudder, acceleration, concealment, main battery (reload, range, dispersion, damage per minute, fires per minute), every shell (with penetration, flight time and impact angle every 1 km), burst fire, secondaries, torpedoes (reaction time, homing), AA auras and flak, carrier squadrons and their weapons, airstrikes, depth charges, submarine sonar, consumables with their effects, and special abilities.
- **Every upgrade, captain skill and signal flag** for each ship, with its exact before → after effect on every stat, plus the best value each stat can reach with upgrades and which upgrades give it.
- **About 1,000 rankings**: every numeric stat ranked across all ships, both base and "best with upgrades", with filtered versions per class, class + tier, tier and nation. To filter by several nations, filter the full list.
- **Data sets**: all upgrades, captain skills, signal flags, consumables, projectiles and aircraft.
- **Checks**: automatic validation on every build (`/api/validation.json`; the build stops if data looks broken), and a cross-check against the official wiki (`/api/verification.json`).

## Where the numbers come from

- **Game data**: the public data files of [WoWs ShipBuilder](https://app.wowssb.com), which are extracted from the game client every patch. No account or key is needed, and every file's checksum is verified.
- **Calculations**: a line-by-line JavaScript port of ShipBuilder's open-source (MIT) stat formulas, including its rounding, constants and upgrade/skill effect rules. Where ShipBuilder rounds away information, this site keeps more precision (for example HE penetration 54.9 mm instead of 54).
- **Cross-check**: every number in the stat tables of the official wiki (wiki.worldofwarships.com) is compared with this data. The report lists every difference, including the ones that come from outdated wiki pages.

Game data © Wargaming.net. Unofficial; not affiliated with Wargaming or WoWs ShipBuilder.

## Build it yourself

```bash
node build.mjs
```

This needs Node 18+ and no packages. Output goes to `dist/` (about 30,000 files, roughly 400 MB). Options: `SITE_URL=https://...` for absolute links, `WOWS_SERVER=pts` for public test server data, and `NODE_USE_ENV_PROXY=1` behind an HTTPS proxy.

Re-run the wiki cross-check (it takes about 15 minutes, at one request per second to the wiki):

```bash
python3 -I tools/fetch_wiki.py DATA_DIR wiki-cache
```

```bash
python3 -I tools/crosscheck.py dist wiki-cache verification/wiki-crosscheck.json
```

`DATA_DIR` is a folder with the downloaded ShipBuilder data (`VersionInfo.json`, `Ship/`, `Localization/`, ...).

## Hosting

GitHub Pages: in the repo, go to Settings → Pages → Source and choose **GitHub Actions**. The workflow in `.github/workflows/build.yml` then builds and deploys every day.
