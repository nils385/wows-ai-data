# Extracts the armor table (belt, deck, superstructure, extremities) from cached wiki pages
# into verification/wiki-armor.json, which the site build merges into each ship.
# The game data used by this site has no armor thickness, so the official wiki is the source here.
# Usage: python3 -I extract_wiki_armor.py DIST_DIR WIKI_PAGES_DIR OUT_JSON
import json, os, re, sys, unicodedata, urllib.parse, datetime

dist, pages, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
index = json.load(open(os.path.join(dist, 'api', 'index.json')))['ships']
norm = lambda s: unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower().strip()
pref = {'tech_tree': 0, 'premium': 1, 'special': 2}
by_name = {}
for s in index:
    by_name.setdefault(norm(s['name']), []).append(s)
def pick_ship(cands):
    """Unambiguous match only: one candidate, or exactly one tech-tree ship, else exactly one premium ship."""
    if len(cands) == 1:
        return dict(cands[0], match_reason='only ship with this name')
    for cat in ('tech_tree', 'premium'):
        hit = [c for c in cands if c['category'] == cat]
        if len(hit) == 1:
            return dict(hit[0], match_reason=f'{len(cands)} ships share this name; picked the only {cat} one: ' + ', '.join(c['index'] for c in cands))
    return None

FIELDS = {'Belt': 'belt_mm', 'Deck': 'deck_mm', 'Superstructure': 'superstructure_mm', 'Extremities': 'extremities_mm'}

ships, skipped = {}, []
for fname in sorted(os.listdir(pages)):
    name = urllib.parse.unquote(fname[:-5])
    try:
        text = json.load(open(os.path.join(pages, fname)))['parse']['wikitext']['*']
    except Exception:
        continue
    i = text.find('ARMOR DETAIL')
    cands = by_name.get(norm(name), [])
    ship = pick_ship(cands) if cands else None
    if i < 0 or ship is None:
        skipped.append(name)
        continue
    block = re.sub(r'style="[^"]*"', '', text[i:text.find('|}', i)])
    armor = {}
    for m in re.finditer(r'•\s*([A-Za-z]+)[^|]*\|\|\s*\|?\s*([^\n|]*)', block):
        key = FIELDS.get(m.group(1))
        if not key:
            continue
        raw = m.group(2).strip()
        nums = [float(x) for x in re.findall(r'\d+(?:\.\d+)?', raw)]
        if not nums:  # "—" means the wiki lists no value; never overwrite a real value with it
            armor.setdefault(key, None)
            continue
        if armor.get(key) is not None:
            continue  # keep the first real value
        armor[key] = int(max(nums)) if max(nums).is_integer() else max(nums)
        if len(nums) > 1:
            armor[key.replace('_mm', '_min_mm')] = int(min(nums)) if min(nums).is_integer() else min(nums)
    if armor:
        ships[ship['index']] = {'wiki_page': f'https://wiki.worldofwarships.com/Ship:{urllib.parse.quote(name)}', **({'match_note': ship['match_reason']} if ship['match_reason'] != 'only ship with this name' else {}), **armor}

json.dump({
    'about': 'Armor thickness from the official World of Warships wiki ARMOR DETAIL tables (the game data used for the rest of this site has no armor values). Maximum value per area; *_min_mm is given where the wiki lists a range. The wiki is edited by hand, so values can lag behind game changes.',
    'source': 'https://wiki.worldofwarships.com', 'retrieved': datetime.date.today().isoformat(), 'ships': ships,
}, open(out_path, 'w'), indent=1, ensure_ascii=False)
print('armor for', len(ships), 'ships; skipped', len(skipped))
