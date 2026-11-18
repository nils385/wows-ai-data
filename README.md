# WoWs data for AIs

A static website of World of Warships ship data made for AI agents, not people: `llms.txt`, JSON, JSONL, CSV and Markdown, with units in every field name. It rebuilds itself every day, so new patches show up automatically.

**AI agents: start at `/llms.txt`.**

## What's on the site

| path | what |
|---|---|
| `/llms.txt` | entry point: what's here and which file answers which question |
| `/llms-full.txt` | every ship as a Markdown stat sheet, in one file |
| `/api/index.json` | short list of all ships |
| `/api/name-lookup.json` | lowercase name → ship index |
| `/api/ships/{index}.json` | one ship, e.g. `/api/ships/PJSB018.json` (Yamato) |
| `/api/ships.json`, `/ships.jsonl` | every ship, full records |
| `/ships.csv` | one flat row per ship (fully upgraded configuration) |
| `/api/by-tier/{n}.json`, `/api/by-nation/{x}.json`, `/api/by-class/{x}.json` | filtered lists |
| `/api/schema.json` | every field, its unit, and caveats |
| `/api/test-ships.json` | unreleased/in-testing ships, kept out of the main lists |

Every ship has a `stock` and a `top` (fully researched) configuration: HP, speed, concealment, main battery and shells, secondaries, torpedoes, AA, submarine battery, aircraft, consumables, price and tech-tree links.

## Data source

The data comes from the public data files of [WoWs ShipBuilder](https://app.wowssb.com), which extracts them from the game client each patch. No account or API key is needed. Checksums are verified on every build. Game data © Wargaming.net. This site is unofficial and not affiliated with Wargaming or WoWs ShipBuilder.

## Build it yourself

```bash
node build.mjs
```

Needs Node 18+ and no packages. Output goes to `dist/`. Options: `SITE_URL=https://...` for absolute links, `WOWS_SERVER=pts` for public test server data, and `NODE_USE_ENV_PROXY=1` if you're behind an HTTPS proxy.
