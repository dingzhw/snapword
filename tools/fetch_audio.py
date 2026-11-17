"""Fetch open-licensed human pronunciation clips from Wiktionary / Wikimedia Commons."""
import argparse
import html
import json
import re
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = ROOT / "audio"
MANIFEST = AUDIO_DIR / "attribution.json"

TARGET_WORDS = [
    "morning", "afternoon", "homework", "football", "sometimes", "often", "never",
    "friend", "friends", "walk", "work", "ball", "with",
    "between", "wall", "neighbour", "heavy", "drink", "some", "space",
    "their", "too", "use", "letter", "advice", "important", "friendly",
    "then", "time", "favourite", "problem", "classmate",
]

UA = "SnapWordAudioFetcher/0.1 (open-source primary English learning tool)"


def read_bytes(url):
    with urlopen(Request(url, headers={"User-Agent": UA}), timeout=15) as resp:
        return resp.read(2_500_000)


def wiki_api(domain, **params):
    url = f"https://{domain}/w/api.php?" + urlencode({"format": "json", "formatversion": 2, **params})
    return json.loads(read_bytes(url))


def batch_query(domain, titles, **params):
    pages = {}
    for i in range(0, len(titles), 30):
        res = wiki_api(domain, action="query", titles="|".join(titles[i:i + 30]), redirects=1, **params)
        data = res.get("query", {})
        batch = {p["title"]: p for p in data.get("pages", [])}
        for alias in reversed(data.get("normalized", []) + data.get("redirects", [])):
            if alias["to"] in batch:
                batch[alias["from"]] = batch[alias["to"]]
        pages.update(batch)
    return pages


def plain_text(val):
    return html.unescape(re.sub(r"<[^>]+>", "", val or "")).strip()


def find_candidates(words):
    pages = batch_query("en.wiktionary.org", words, prop="revisions", rvprop="content", rvslots="main")
    out = {}
    for w in words:
        revs = pages.get(w, {}).get("revisions", [])
        content = revs[0]["slots"]["main"]["content"] if revs else ""
        sec = re.search(r"^==English==\s*$(.*?)(?=^==[^=\n]+==\s*$|\Z)", content, re.M | re.S)
        eng = sec.group(1) if sec else ""
        recs = re.findall(r"\{\{audio\|en\|([^|}]+)([^}]*)\}\}", eng, re.I)
        recs.sort(key=lambda pair: not bool(re.search(r"\b(UK|British|RP)\b", " ".join(pair), re.I)))
        guessed = [f"En-{acc}-{n}.ogg" for n in dict.fromkeys([w, w.lower()]) for acc in ("uk", "us")]
        out[w] = list(dict.fromkeys([n.strip() for n, _ in recs] + guessed))
    return out


def build_catalog(words):
    choices = find_candidates(words)
    titles = list(dict.fromkeys("File:" + n for names in choices.values() for n in names))
    if not titles:
        return {}
    pages = batch_query("commons.wikimedia.org", titles, prop="imageinfo|transcodestatus", iiprop="url|mime|extmetadata")
    found = {}
    for w, names in choices.items():
        for name in names:
            page = pages.get("File:" + name, {})
            details = page.get("imageinfo")
            if not details:
                continue
            info = details[0]
            meta = info.get("extmetadata", {})
            lic = meta.get("LicenseShortName", {}).get("value", "")
            if not (lic in ("Public domain", "CC0") or re.fullmatch(r"CC BY(?:-SA)? [\d.]+(?: [A-Z]+)?", lic)):
                continue
            src = urlsplit(info["url"])
            if src.scheme != "https" or src.hostname != "upload.wikimedia.org":
                continue
            mp3_ok = page.get("transcodestatus", {}).get("mp3", {}).get("time_success")
            p = src.path
            if mp3_ok:
                fname = p.rsplit("/", 1)[-1]
                p = p.replace("/commons/", "/commons/transcoded/", 1) + "/" + fname + ".mp3"
            found[w] = {
                "file": name,
                "media": urlunsplit(src._replace(path=p, query="")),
                "page": info["descriptionurl"],
                "license": lic,
                "licenseUrl": meta.get("LicenseUrl", {}).get("value", ""),
                "author": plain_text(meta.get("Artist", {}).get("value", "")) or "Wikimedia Commons contributor",
            }
            break
    return found


def transcode_download(word, entry):
    slug = re.sub(r"[^a-z0-9]+", "_", word.lower()).strip("_")
    dst_name = f"{slug}.mp3"
    dst_path = AUDIO_DIR / dst_name
    if dst_path.exists():
        return {**entry, "asset": dst_name}
    raw = read_bytes(entry["media"])
    proc = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-loglevel", "error", "-i", "pipe:0", "-map", "0:a:0",
            "-af", "loudnorm=I=-19:TP=-2:LRA=11", "-ac", "1", "-ar", "24000", "-b:a", "48k", "-f", "mp3", "pipe:1",
        ],
        input=raw, capture_output=True, check=True,
    )
    if not (800 < len(proc.stdout) < 120_000):
        raise ValueError(f"Unexpected MP3 byte size for {word}: {len(proc.stdout)}")
    dst_path.write_bytes(proc.stdout)
    time.sleep(0.6)
    return {**entry, "asset": dst_name}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    saved = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    missing = [w for w in TARGET_WORDS if w not in saved or not (AUDIO_DIR / saved[w]["asset"]).exists()]
    if not missing:
        print("All target words already have local open-licensed recordings:", len(saved))
        return

    try:
        catalog = build_catalog(missing)
    except (URLError, TimeoutError, OSError) as exc:
        print(f"Network unavailable or restricted ({exc}); keeping {len(saved)} existing clips.")
        return

    print(f"Found {len(catalog)}/{len(missing)} open-licensed clips on Wikimedia Commons.")
    if args.download:
        for w, entry in catalog.items():
            try:
                saved[w] = transcode_download(w, entry)
                print(f"Saved: {w} -> {saved[w]['asset']} ({entry['license']})", flush=True)
            except (HTTPError, URLError, OSError, ValueError, subprocess.SubprocessError) as exc:
                print(f"Skip {w}: {exc}", flush=True)
        MANIFEST.write_text(json.dumps(saved, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Total local open-licensed human clips: {len(saved)}")


if __name__ == "__main__":
    main()
