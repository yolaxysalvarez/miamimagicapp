# Avisa a IndexNow (Bing, Yandex, Seznam, Naver...) de las notas nuevas o actualizadas.
# Compara noticias.json del commit anterior con el actual.
import json, subprocess, sys, urllib.request
KEY = "0425fbab47ff1bbddbd7f6a627cea491"
HOST = "www.miamimagicapp.com"
BASE = "https://" + HOST
def load(rev):
    try:
        return json.loads(subprocess.check_output(["git", "show", f"{rev}:noticias.json"]))
    except Exception:
        return {"notas": []}
before = sys.argv[1] if len(sys.argv) > 1 else "HEAD~1"
old = {} if before == "ALL" else {n["id"]: n for n in load(before).get("notas", [])}
new = load("HEAD").get("notas", [])
urls = []
for n in new:
    o = old.get(n["id"])
    if o is None or o.get("actualizada") != n.get("actualizada") or o.get("es") != n.get("es"):
        urls += [f"{BASE}/noticias/{n['id']}", f"{BASE}/news/{n['id']}"]
if not urls:
    print("Sin notas nuevas o cambiadas."); sys.exit(0)
urls += [f"{BASE}/noticias", f"{BASE}/news"]
body = json.dumps({"host": HOST, "key": KEY, "keyLocation": f"{BASE}/{KEY}.txt", "urlList": urls[:10000]}).encode()
req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body, headers={"Content-Type": "application/json; charset=utf-8"})
try:
    r = urllib.request.urlopen(req, timeout=30); print("IndexNow", r.status, len(urls), "URLs")
except urllib.error.HTTPError as e:
    print("IndexNow error", e.code, e.read()[:300]); sys.exit(0 if e.code in (200, 202) else 1)
print("\n".join(urls))
