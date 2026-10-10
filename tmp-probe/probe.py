# Временный сбор открытых данных о похожих каналах: страница канала (id, название, подписчики из
# метаданных), официальная RSS-лента (последние 15 роликов: просмотры, лайки, даты, названия) и
# признак Shorts (/shorts/ID отдаёт 200, обычное видео — перенаправление). Только чтение.
import json, re, sys, time, urllib.parse, urllib.request, xml.etree.ElementTree as ET

UA = {"User-Agent": "Mozilla/5.0", "Accept-Language": "ru-RU,ru;q=0.9"}
def get(url, method="GET"):
    req = urllib.request.Request(url, headers=UA, method=method)
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k): return None
    opener = urllib.request.build_opener(NoRedirect) if method == "HEAD" else urllib.request.build_opener()
    try:
        with opener.open(req, timeout=25) as r: return r.status, r.read().decode("utf-8", "replace") if method == "GET" else ""
    except urllib.error.HTTPError as e: return e.code, ""
    except Exception as e: return 0, str(e)

ns = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015", "m": "http://search.yahoo.com/mrss/"}
out = []
for ref in [l.strip() for l in open("tmp-probe/channels.txt", encoding="utf-8") if l.strip() and not l.startswith("#")]:
    url = ref if ref.startswith("http") else "https://www.youtube.com/" + urllib.parse.quote(ref if ref.startswith("@") else "@" + ref)
    st, html = get(url)
    cid = (re.search(r'"externalId":"(UC[\w-]+)"', html) or re.search(r'channel_id=(UC[\w-]+)', html) or [None, None])[1] if st == 200 else None
    title = (re.search(r'<meta property="og:title" content="([^"]*)"', html) or [None, None])[1] if st == 200 else None
    subs = (re.search(r'"content":"([\d.,\s]+\s*(?:K|M|тыс\.|млн)?\s*(?:subscribers?|подписчик\w*))"', html) or re.search(r'([\d.,]+\s*(?:K|M|тыс\.|млн)?\s*(?:subscribers|подписчик\w*))', html) or [None, None])[1] if st == 200 else None
    ch = {"ref": ref, "status": st, "channelId": cid, "title": title, "subscribers": subs, "videos": []}
    if cid:
        fs, feed = get(f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}")
        try:
            root = ET.fromstring(feed)
            for e in root.findall("a:entry", ns):
                vid = e.find("yt:videoId", ns).text
                g = e.find("m:group", ns)
                stt = g.find("m:community/m:statistics", ns); rt = g.find("m:community/m:starRating", ns)
                desc = (g.find("m:description", ns).text or "").strip()
                hs, _ = get(f"https://www.youtube.com/shorts/{vid}", "HEAD")
                ch["videos"].append({"id": vid, "published": e.find("a:published", ns).text, "title": e.find("a:title", ns).text,
                    "views": int(stt.get("views")) if stt is not None else None, "likes": int(rt.get("count")) if rt is not None else None,
                    "short": hs == 200, "desc": desc[:600], "descLen": len(desc), "hashtags": re.findall(r"#[\w\d_]+", (e.find("a:title", ns).text or "") + " " + desc)})
                if len(ch["videos"]) <= 8:
                    import os; d = f"tmp-probe/thumbs/{ref.strip('@').replace('/', '_')[:40]}"; os.makedirs(d, exist_ok=True)
                    for kind in ("oardefault", "hqdefault"):
                        try:
                            data = urllib.request.urlopen(urllib.request.Request(f"https://i.ytimg.com/vi/{vid}/{kind}.jpg", headers=UA), timeout=20).read()
                            if len(data) > 3000: open(f"{d}/{vid}-{kind}.jpg", "wb").write(data); break
                        except Exception: pass
                time.sleep(0.3)
        except Exception as ex:
            ch["feedError"] = f"{fs} {ex}"
    if cid and not ch["videos"]:
        # RSS пустая (у новых каналов так бывает) — список Shorts со страницы канала: название и «N views».
        base = url.rstrip("/")
        ss, sh = get(base + "/shorts")
        items = re.findall(r'"entityId":"shorts-shelf-item-([\w-]{11})".{0,4000}?"primaryText":\{"content":"((?:[^"\\]|\\.)*)"\},"secondaryText":\{"content":"([^"]*)"', sh, re.S)
        ch["shortsTab"] = [{"id": i, "title": t, "views": v} for i, t, v in items[:30]]
        ch["shortsTabStatus"] = ss
    out.append(ch)
    time.sleep(1)
print("PROBE_JSON_BEGIN"); print(json.dumps(out, ensure_ascii=False)); print("PROBE_JSON_END")
