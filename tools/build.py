"""Build standalone offline HTML bundle and GitHub Pages entry for 词哒 · SnapWord."""
import base64
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
AUDIO_DIR = ROOT / "audio"
DIST = ROOT / "dist"


def build_audio_payload():
    manifest_path = AUDIO_DIR / "attribution.json"
    if not manifest_path.exists():
        return "const SNAPWORD_AUDIO_CLIPS = {};", ""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    bundled = {}
    credit_lines = [
        "词哒 · SnapWord 内置公开授权真人发音署名清单",
        "================================================",
        ""
    ]
    for word, info in manifest.items():
        mp3_path = AUDIO_DIR / info["asset"]
        if not mp3_path.exists():
            continue
        b64 = base64.b64encode(mp3_path.read_bytes()).decode("ascii")
        bundled[word] = {
            "asset": info["asset"],
            "data": f"data:audio/mpeg;base64,{b64}",
            "author": info.get("author", ""),
            "license": info.get("license", ""),
            "licenseUrl": info.get("licenseUrl", ""),
            "page": info.get("page", ""),
        }
        credit_lines.append(
            f"- {word}: {info.get('author', '')} | {info.get('license', '')} | {info.get('page', '')}"
        )

    js_code = "const SNAPWORD_AUDIO_CLIPS = " + json.dumps(bundled, ensure_ascii=False) + ";"
    return js_code, "\n".join(credit_lines) + "\n"


def main():
    DIST.mkdir(parents=True, exist_ok=True)
    template = (SRC / "index.html").read_text(encoding="utf-8")
    audio_js, credits_txt = build_audio_payload()

    replacements = [
        ("/*SNAPWORD_STYLE*/", (SRC / "style.css").read_text(encoding="utf-8")),
        ("/*SNAPWORD_AUDIO_DATA*/", audio_js),
        ("/*SNAPWORD_CURRICULUM*/", (SRC / "curriculum.js").read_text(encoding="utf-8")),
        ("/*SNAPWORD_CORE*/", (SRC / "core.js").read_text(encoding="utf-8")),
        ("/*SNAPWORD_AUDIO*/", (SRC / "audio.js").read_text(encoding="utf-8")),
        ("/*SNAPWORD_AI*/", (SRC / "ai.js").read_text(encoding="utf-8")),
        ("/*SNAPWORD_APP*/", (SRC / "app.js").read_text(encoding="utf-8")),
    ]

    html_out = template
    for marker, content in replacements:
        if marker not in html_out:
            raise RuntimeError(f"Missing template placeholder: {marker}")
        # Use lambda replacement or split/join to avoid any accidental string pattern issues
        html_out = html_out.replace(marker, content, 1)

    portable_file = DIST / "SnapWord-词哒.html"
    pages_file = DIST / "index.html"
    portable_file.write_text(html_out, encoding="utf-8")
    pages_file.write_text(html_out, encoding="utf-8")

    if credits_txt:
        (DIST / "AUDIO_ATTRIBUTION.txt").write_text(credits_txt, encoding="utf-8")

    sha = hashlib.sha256(portable_file.read_bytes()).hexdigest()
    size_kb = portable_file.stat().st_size / 1024
    print(f"Built {portable_file.name} ({size_kb:.1f} KB) | SHA256: {sha}")


if __name__ == "__main__":
    main()
