# Politely downloads the wiki source of each ship page (1 request per second) into a cache directory.
import json, glob, os, sys, time, urllib.parse, urllib.request
data_dir, out_dir = sys.argv[1], sys.argv[2]
L = json.load(open(os.path.join(data_dir, 'Localization', 'en.json')))
ships = {}
for f in glob.glob(os.path.join(data_dir, 'Ship', '*.json')):
    ships.update(json.load(open(f)))
names = sorted({L.get(i, i) for i, s in ships.items() if s['shipCategory'] != 'TestShip'})
done = 0
for n in names:
    path = os.path.join(out_dir, urllib.parse.quote(n, safe='') + '.json')
    if os.path.exists(path):
        continue
    url = 'https://wiki.worldofwarships.com/api.php?' + urllib.parse.urlencode({'action': 'parse', 'page': 'Ship:' + n, 'prop': 'wikitext', 'redirects': 1, 'format': 'json'})
    req = urllib.request.Request(url, headers={'User-Agent': 'wows-ai-data-validator/1.0 (stat cross-check)'})
    try:
        body = urllib.request.urlopen(req, timeout=60).read()
    except Exception as e:
        body = json.dumps({'fetch_error': str(e)}).encode()
    open(path, 'wb').write(body)
    done += 1
    time.sleep(1)
print('fetched', done, 'of', len(names))
