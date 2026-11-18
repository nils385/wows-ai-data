# Extracts the community terminology table from the official wiki page Ship:Terminology
# into verification/wiki-terminology.json (term -> short definition), used by the glossary page.
# Usage: python3 -I extract_wiki_terms.py WIKI_JSON OUT_JSON   (WIKI_JSON = api.php?action=parse&prop=wikitext output)
import json, re, sys, datetime

src, out_path = sys.argv[1], sys.argv[2]
text = json.load(open(src))['parse']['wikitext']['*']

def clean(s):
    s = re.sub(r'<[^>]+>', '', s)
    s = re.sub(r'\{\{[^}]*\}\}', '', s)
    s = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', s)
    s = re.sub(r"'''?", '', s).replace('&mdash;', '-').replace('&nbsp;', ' ').replace('&thinsp;', ' ')
    s = re.sub(r'(?i)\bsee also\b.*$|\bsee [A-Z][^.]*\.?$', '', s)
    s = s.replace('-->', '')
    return re.sub(r'\s+', ' ', s).strip()

terms = []
for line in text.split('\n'):
    if not line.startswith('|') or '||' not in line or line.startswith('|-') or line.startswith('|}'):
        continue
    cells = [re.sub(r'^\s*(style="[^"]*"\s*\|)?', '', c).strip() for c in line.lstrip('|').split('||')]
    if len(cells) < 2:
        continue
    term, definition = clean(cells[0]), clean(' '.join(cells[1:]))
    if term and definition and len(term) < 60:
        terms.append({'term': term, 'definition': definition})

json.dump({
    'about': 'Community terminology from the official World of Warships wiki page Ship:Terminology (short definitions). Attribution: wiki.worldofwarships.com.',
    'source': 'https://wiki.worldofwarships.com/Ship:Terminology', 'retrieved': datetime.date.today().isoformat(), 'terms': terms,
}, open(out_path, 'w'), indent=1, ensure_ascii=False)
print(len(terms), 'terms')
