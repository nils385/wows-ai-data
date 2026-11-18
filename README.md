# WoWs data for AIs

An unofficial, non-commercial World of Warships encyclopedia: a page for every ship, a searchable ship list, rankings, a comparison tool and guides. All of it is also published as structured data (JSON, CSV, Markdown, `llms.txt`) for AI tools and developers, generated from the same records so the numbers can never disagree. It checks for new game data every 6 hours, so new patches show up automatically.

**Players: start at the homepage. AI agents and developers: start at `/llms.txt`.**

## Pages for players

| page | what |
|---|---|
| `/` | homepage with search, classes, nations and guides |
| `/ships/` | every ship in one table, filterable by class, tier, nation and type |
| `/ships/{name-index}/` | one ship: summary, armor, all stats, shells and ballistics, upgrades, commander skills, signals, modules, change history |
| `/compare.html?ships=PJSB018,PASB018` | up to four ships side by side |
| `/rankings/` and `/rankings/{metric}/` | leaderboards for every stat, filterable |
| `/guides/…` | mechanics, glossary, tech trees, upgrades/skills/signals, changes, community opinion |
| `/about/`, `/legal/` | data sources, checks, legal notice and attribution |

Pages work without JavaScript; a small script (`/assets/site.js`) only adds filtering and the comparison tool. No frameworks, no tracking, no cookies.

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

## Legal

Unofficial fan project, not endorsed by Wargaming (Player Content Policy disclaimer on every page). No ads or paid features, no Wargaming logos or artwork. Game data © Wargaming.net; formulas ported from WoWs ShipBuilder (MIT); armor values from the official wiki. See `/legal/`.

## Build it yourself

```bash
node build.mjs
```

Then run the tests (known values, page integrity, site size): `node tests/check-output.mjs dist`.

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

GitHub Pages: in the repo, go to Settings → Pages → Source and choose **GitHub Actions**. The workflow in `.github/workflows/build.yml` then builds and deploys every 6 hours.
