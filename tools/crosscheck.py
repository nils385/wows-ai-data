# Compares the built site's ship stats with the official World of Warships wiki (cached wikitext pages).
# Every number the wiki shows in its stat tables is checked against the matching value in any module
# configuration of the ship, using the wiki's own rounding as tolerance.
# Usage: python3 -I crosscheck.py DIST_DIR WIKI_PAGES_DIR OUT_JSON
import json, os, re, sys, urllib.parse, unicodedata
from collections import Counter, defaultdict

dist, pages, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
index = json.load(open(os.path.join(dist, 'api', 'index.json')))['ships']

def norm(s):
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower().strip()

# (section regex, label regex) -> list of metric path templates searched in configuration stats
RULES = [
    (r'^SURVIVABILITY$', r'^Hit Points$', ['survivability.hit_points']),
    (r'^SURVIVABILITY$', r'^Torpedo protection', ['survivability.flooding.torpedo_protection_damage_reduction_pct']),
    (r'^MANEUVERABILITY$', r'^Maximum speed', ['maneuverability.max_speed_knots', 'maneuverability.max_speed_surface_knots']),
    (r'^MANEUVERABILITY$', r'^Turning circle', ['maneuverability.turning_circle_radius_m']),
    (r'^MANEUVERABILITY$', r'^Rudder-shift', ['maneuverability.rudder_shift_time_s']),
    (r'^CONCEALMENT$', r'^Detectability by sea', ['concealment.detectability_by_ships_km']),
    (r'^CONCEALMENT$', r'^Detectability by air', ['concealment.detectability_by_planes_km']),
    (r'^CONCEALMENT$', r'in smoke', ['concealment.detectability_when_firing_from_smoke_km']),
    (r'^CONCEALMENT$', r'by depths', ['concealment.detectability_by_submarines_at_periscope_depth_km']),
    (r'^MAIN BATTERY$', r'^Firing range', ['main_battery.range_km']),
    (r'^MAIN BATTERY$', r'^Reload time', ['main_battery.reload_s']),
    (r'^MAIN BATTERY$', r'^180', ['main_battery.turret_180_turn_time_s']),
    (r'^DISPERSION$', r'^Sigma', ['main_battery.sigma']),
    (r'^DISPERSION$', r'^Maximum dispersion', ['main_battery.dispersion_at_max_range_horizontal_m']),
    (r'^(HE|AP|SAP) SHELL$', r'^Maximum damage', ['main_battery.shells.{t}.damage']),
    (r'^HE SHELL$', r'^Fire chance', ['main_battery.shells.he.fire_chance_pct']),
    (r'^(HE|AP|SAP) SHELL$', r'^Shell velocity', ['main_battery.shells.{t}.muzzle_velocity_m_s']),
    (r'^(HE|AP|SAP) SHELL$', r'^Shell weight', ['main_battery.shells.{t}.mass_kg']),
    (r'^(HE|SAP) SHELL$', r'^Penetration', ['main_battery.shells.{t}.penetration_mm']),
    (r'^(AP|SAP) SHELL$', r'^Ricochet start', ['main_battery.shells.{t}.ricochet_start_angle_deg']),
    (r'^(AP|SAP) SHELL$', r'^Always ricochet', ['main_battery.shells.{t}.ricochet_always_angle_deg']),
    (r'^AP SHELL$', r'^Fuse time', ['main_battery.shells.ap.fuse_time_s']),
    (r'^AP SHELL$', r'^Arming threshold', ['main_battery.shells.ap.arming_threshold_mm']),
    (r'^SECONDARY BATTERY$', r'range', ['secondaries.range_km']),
    (r'^TORPEDO LAUNCHERS$', r'^Reload time', ['torpedoes.reload_s']),
    (r'^TORPEDO LAUNCHERS$', r'^180', ['torpedoes.launcher_180_turn_time_s']),
    (r'^TORPEDO LAUNCHERS$', r'^Damage', ['torpedoes.torpedoes.*.damage']),
    (r'^TORPEDO LAUNCHERS$', r'^(Range|Firing range)', ['torpedoes.torpedoes.*.range_km']),
    (r'^TORPEDO LAUNCHERS$', r'^(Speed|Torpedo speed)', ['torpedoes.torpedoes.*.speed_knots']),
    (r'^TORPEDO LAUNCHERS$', r'^Detectab', ['torpedoes.torpedoes.*.detectability_km']),
    (r'^TORPEDO LAUNCHERS$', r'^Reaction', ['torpedoes.torpedoes.*.reaction_time_s']),
    (r'^TORPEDO LAUNCHERS$', r'^Flooding', ['torpedoes.torpedoes.*.flooding_chance_pct']),
]
AA_ROWS = {'short-range': 'short_range', 'medium-range': 'medium_range', 'mid-range': 'medium_range', 'long-range': 'long_range'}

def numbers(cell):
    cell = cell.replace(' ', '').replace('\xa0', ' ')
    if re.search(r'[×x]\s*\d', cell) or '—' in cell:
        return []
    out = []
    for m in re.finditer(r'(-?\d[\d,]*(?:\.\d+)?)', cell):
        raw = m.group(1).replace(',', '')
        dec = len(raw.split('.')[1]) if '.' in raw else 0
        out.append((float(raw), dec))
    return out

def parse_tables(text):
    i = text.find('==Ship Stats==')
    if i < 0:
        return []
    s = text[i:]
    s = re.sub(r'style="[^"]*"', '', s)
    s = re.sub(r'colspan="(\d+)"', r'COLSPAN\1', s)
    s = re.sub(r'<[^>]+>', '\n', s)
    rows, section = [], None
    for line in s.split('\n'):
        line = line.strip()
        if line.startswith('!'):
            m = re.match(r'!\s*\|\s*([^!|]+?)\s*(!!|$)', line)
            section = m.group(1).strip() if m else None
            continue
        if line.startswith('|') and not line.startswith('|}') and not line.startswith('|-') and section:
            cells = [c.strip().lstrip('|').strip() for c in re.split(r'\|\|', line)]
            if len(cells) < 2:
                continue
            label = re.sub(r'^[|\s•]+', '', cells[0]).strip()
            vals = []
            for c in cells[1:]:
                span = re.search(r'COLSPAN(\d+)', c)
                c = re.sub(r'COLSPAN\d+\s*\|?', '', c)
                vals.extend(numbers(c) * (int(span.group(1)) if span else 1))
            rows.append((section, label, vals, cells))
    return rows

def flatten(o, prefix=''):
    out = {}
    if isinstance(o, dict):
        for k, v in o.items():
            out.update(flatten(v, f'{prefix}.{k}' if prefix else k))
    elif isinstance(o, (int, float)) and not isinstance(o, bool):
        out[prefix] = o
    return out

def candidates(flat, template, shell_type):
    t = template.replace('{t}', shell_type)
    if '*' in t:
        rx = re.compile('^' + re.escape(t).replace(r'\*', r'[^.]+') + '$')
        return [v for k, v in flat.items() if rx.match(k)]
    return [flat[t]] if t in flat else []

def pick_ship(cands):
    """Unambiguous match only: one candidate, or exactly one tech-tree ship, else exactly one premium ship."""
    if len(cands) == 1:
        return dict(cands[0], match_reason='only ship with this name')
    for cat in ('tech_tree', 'premium'):
        hit = [c for c in cands if c['category'] == cat]
        if len(hit) == 1:
            return dict(hit[0], match_reason=f'{len(cands)} ships share this name; picked the only {cat} one: ' + ', '.join(c['index'] for c in cands))
    return None

by_name = defaultdict(list)
for s in index:
    by_name[norm(s['name'])].append(s)
pref = {'tech_tree': 0, 'premium': 1, 'special': 2}

results, checked_ships, missing_pages, ambiguous = [], 0, [], []
stats = Counter()
strict = Counter()
strict_other = Counter()
strict_examples = {}
for fname in sorted(os.listdir(pages)):
    name = urllib.parse.unquote(fname[:-5])
    try:
        page = json.load(open(os.path.join(pages, fname)))
    except Exception:
        continue
    text = page.get('parse', {}).get('wikitext', {}).get('*')
    if not text:
        missing_pages.append(name)
        continue
    cands = by_name.get(norm(name), [])
    if not cands:
        continue
    ship = pick_ship(cands)
    if ship is None:
        ambiguous.append({'wiki_page': name, 'ships': [c['index'] for c in cands]})
        continue
    data = json.load(open(os.path.join(dist, 'api', 'ships', ship['index'] + '.json')))
    confs = json.load(open(os.path.join(dist, 'api', 'ships', ship['index'], 'configurations.json')))['configurations']
    flats = [flatten(c['stats']) for c in confs]
    top_flat = [flatten(c['stats']) for c in confs if c.get('is_top')] or flats[-1:]
    rows = parse_tables(text)
    if not rows:
        missing_pages.append(name)
        continue
    checked_ships += 1
    aa_mode = None
    for section, label, vals, cells in rows:
        targets = None
        stype = ''
        for sec_rx, lab_rx, paths in RULES:
            if re.search(sec_rx, section) and re.search(lab_rx, label, re.I):
                targets = paths
                mm = re.match(r'^(HE|AP|SAP) SHELL$', section)
                stype = mm.group(1).lower() if mm else ''
                break
        if section == 'RANGE' and label.lower() in AA_ROWS and vals:
            targets = [f'anti_air.{AA_ROWS[label.lower()]}.continuous_damage_per_s']
            vals = vals[:1]
        if section.startswith('EXPLOSIONS'):
            vals = numbers(re.sub(r'^\|?\s*', '', cells[0])) + vals  # first column holds the burst count
        if section.startswith('EXPLOSIONS') and len(vals) >= 2:
            for (v, d), path in zip(vals[:2], ['anti_air.long_range.flak_bursts_per_salvo', 'anti_air.long_range.flak_damage']):
                pool = [x for f in flats for x in candidates(f, path, '')]
                tol = 0.5 * 10 ** -d + 1e-6
                ok = any(abs(x - v) <= tol for x in pool)
                stats['ok' if ok else ('no_value' if not pool else 'mismatch')] += 1
                if not ok:
                    results.append({'ship': ship['name'], 'index': ship['index'], 'section': section, 'label': path, 'wiki': v, 'site_values': sorted(set(pool))[:6], 'status': 'no_value' if not pool else 'mismatch'})
            continue
        if not targets or not vals:
            continue
        single = len(vals) == 1  # one wiki column: should describe the fully upgraded (top) configuration
        for v, d in vals:
            pool = [x for f in flats for p in targets for x in candidates(f, p, stype)]
            if single:
                tpool = [x for f in top_flat for p in targets for x in candidates(f, p, stype)]
            # wiki rounding: half a unit of its last digit; computed products (range x fire control,
            # 180/traverse) may round the other way at exact halves, so allow one full unit there;
            # the wiki rounds "Maximum dispersion" down.
            unit = 10 ** -d
            tol = unit * (1.0 if re.search(r'range|180|Maximum dispersion', label, re.I) else 0.5) + 1e-6
            ok = any(abs(x - v) <= tol for x in pool)
            status = 'ok' if ok else ('no_value' if not pool else 'mismatch')
            stats[status] += 1
            if single and tpool:
                sok = any(abs(x - v) <= tol for x in tpool)
                strict['ok' if sok else 'mismatch'] += 1
                if not sok and ok:
                    strict_other[f"{section} | {label}"] += 1
                    strict_examples.setdefault(f"{section} | {label}", []).append({'ship': ship['name'], 'wiki': v, 'top': sorted(set(round(x, 3) for x in tpool))[:3]})
            if not ok:
                results.append({'ship': ship['name'], 'index': ship['index'], 'section': section, 'label': label, 'wiki': v, 'site_values': sorted(set(round(x, 3) for x in pool))[:6], 'status': status})

mism = [r for r in results if r['status'] == 'mismatch']
# Human review of the remaining differences (judgement, not proof). Game files are the source of truth here.
ASSESSMENT = [
    'Main battery range, reload, dispersion and AP shell values on ARP, AL, HSF and other collaboration copies (about -9% range): the wiki pages leave out the fire control bonus or predate buffs. The game files say otherwise; this site follows the game files.',
    'Long-range flak bursts on about 30 ships: game files have more bursts than the wiki (Aki: 8 vs 4) while continuous AA damage matches. Probably wiki pages not updated after AA changes.',
    'Secondary battery range on about 45 ships, mostly aircraft carriers: the wiki lists a longer range than the game files (Hornet 8.5 vs 4.5 km). Unresolved: could be an outdated wiki or a bonus the game files used here do not contain. Treat secondary range of carriers with care.',
    'A few French destroyers (fuse time, detectability): probably wiki pages that predate a rework.',
    'Single-value differences (one torpedo speed, one shell weight): not investigated individually.',
    'Strict check (single-column wiki values vs the fully upgraded configuration only): every value that fails it still matches another real module of the same ship. The wiki often shows the stock module in single-column tables (stock fire control for dispersion, stock hull for AA, stock guns for shells), so these are not data errors.',
]
by_label = Counter(f"{r['section']} | {r['label']}" for r in mism)
report = {
    'about': 'Cross-check of this site against the official World of Warships wiki (wiki.worldofwarships.com). Each number in a wiki ship stat table is compared with the same stat in any module configuration of the ship, using the wiki rounding as tolerance. Mismatches can be outdated wiki pages: the wiki is edited by hand and can lag behind game patches.',
    'ships_compared': checked_ships, 'values_compared': sum(stats.values()), 'values_matching': stats['ok'], 'values_different': stats['mismatch'], 'values_not_comparable': stats['no_value'],
    'match_rate_pct': round(100 * stats['ok'] / max(1, stats['ok'] + stats['mismatch']), 2),
    'strict': {'about': 'Single-column wiki values compared only with the fully upgraded (top) configuration.', 'values_compared': strict['ok'] + strict['mismatch'], 'values_matching': strict['ok'], 'match_rate_pct': round(100 * strict['ok'] / max(1, strict['ok'] + strict['mismatch']), 2),
        'matches_another_module_not_top_by_stat': strict_other.most_common(), 'examples': {k: v[:5] for k, v in strict_examples.items()}},
    'checked_on': __import__('datetime').date.today().isoformat(),
    'differences_by_stat': by_label.most_common(),
    'assessment': ASSESSMENT,
    'differences': mism, 'not_comparable': [r for r in results if r['status'] == 'no_value'][:300],
    'pages_without_stat_tables': missing_pages,
    'ambiguous_pages_skipped': ambiguous,
}
json.dump(report, open(out_path, 'w'), indent=1, ensure_ascii=False)
print(json.dumps({k: report[k] for k in ['ships_compared', 'values_compared', 'values_matching', 'values_different', 'values_not_comparable', 'match_rate_pct']}))
for k, n in by_label.most_common(25):
    print(n, k)
