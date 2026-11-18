"""Package 词哒 · SnapWord into a versioned unzip-and-run portable archive under release/."""
import argparse
import hashlib
import re
import zipfile
from pathlib import Path

import build as build_tool

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
AUDIO_DIR = ROOT / "audio"
RELEASE_DIR = ROOT / "release"
CHANGELOG = ROOT / "CHANGELOG.md"


def detect_version() -> str:
    text = CHANGELOG.read_text(encoding="utf-8")
    m = re.search(r"^## \[(\d+\.\d+\.\d+)\]", text, re.M)
    if not m:
        raise RuntimeError("Could not detect semantic version from CHANGELOG.md")
    return m.group(1)


LAUNCHER_CMD = """@echo off
chcp 65001 >nul
title 词哒 · SnapWord 伴学工作台
start "" "%~dp0SnapWord-词哒.html"
"""


def build_usage_guide(version: str, audio_count: int) -> str:
    return f"""================================================================
词哒 · SnapWord 离线解压即用便携包（v{version}）
================================================================

【一、首次发送到孩子电脑的使用步骤】
1. 将本压缩包发送到目标电脑，完整解压到固定位置（例如桌面上的「SnapWord-词哒」文件夹）。
   ⚠️ 请务必先“全部解压缩”再运行，不要直接在压缩软件预览窗口内双击打开！
2. 打开解压后的「SnapWord-词哒」文件夹，双击【启动词哒工作台.cmd】或直接用 Edge / Chrome 打开【SnapWord-词哒.html】。
3. 首次远程连线前，建议进入顶部「🧰 爸爸排课台 → 目标电脑 1 分钟实机试听核验卡」，测试单词真人音与整句系统合成朗读音量。

【二、真人发音与系统语音说明】
- 本压缩包已在主程序与 audio/ 目录中同步收录 {audio_count} 个公开授权真人单词录音（CC / Public Domain），无需联网即可清晰发声。
- 短语与完整重点句默认调用本机浏览器（推荐 Microsoft Edge 或 Google Chrome）的英文语音合成朗读；
  若某台电脑缺少英文系统语音，家长可在「🧰 爸爸排课台 → 为词条绑定自带真人录音」中为重点句上传手机录制的 MP3/WAV 范读。

【三、后续版本升级如何保留徽章与学习记录（重要！）】
1. 浏览器按「文件路径」保存本机学习账本。后续收到新版本压缩包时，请直接解压并【覆盖到同一个文件夹】（保持 SnapWord-词哒.html 路径不变），原来的金银铜徽章、复测日历与错题记录会自动保留！
2. 稳妥起见，也建议每周在「📒 复测与错题 → 导出完整 JSON 备份」顺手保存一份备份文件。
"""


def build_release_readme(version: str, zip_name: str, zip_sha: str, html_sha: str, audio_count: int) -> str:
    return f"""# 词哒 · SnapWord 版本发布归档（`release/`）

本目录存放每次正式迭代打包生成的 **「离线解压即用便携包（`.zip`）」**，方便直接通过微信文件传输、向日葵远程文件或 U 盘发送到学习电脑，解压即用。

## 当前最新发布版本：`v{version}`

- **推荐发送文件**：[`{zip_name}`]({zip_name})
- **压缩包 SHA-256**：`{zip_sha}`
- **内置主程序 `SnapWord-词哒.html` SHA-256**：`{html_sha}`
- **随包收录公开授权真人发音**：`{audio_count}` 个 MP3（同时内嵌于 HTML 并附带独立 `audio/` 源文件目录与署名清单）

### 压缩包内部目录结构

```text
SnapWord-词哒/
├── 启动词哒工作台.cmd          # Windows 一键启动入口
├── SnapWord-词哒.html          # 离线主程序（双击即可在 Edge / Chrome 运行）
├── 使用与升级说明.txt          # 首次解压、音频核验与覆盖升级不丢记录指南
└── audio/                      # 独立公开授权真人发音文件与 CC 许可证明细
    ├── *.mp3
    ├── attribution.json
    └── AUDIO_ATTRIBUTION.txt
```

### 升级不丢记录提示

1. **首次使用**：在目标电脑解压到固定位置（如 `桌面\\SnapWord-词哒\\`）。
2. **后续升级**：下载新版 `.zip` 后，直接解压并**覆盖同一路径下的同名文件夹**，浏览器 IndexedDB 中的金银铜徽章、错题与复测队列即可无缝延续（也可随时在「复测与错题」页导出/导入 JSON 备份）。

### 重新生成发布包命令

```bash
python tools/release.py
```
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default=None, help="Explicit semantic version (e.g. 0.1.5)")
    args = parser.parse_args()

    # 1. Always rebuild dist/ first so bundle & audio payload are fresh
    build_tool.main()

    version = (args.version or detect_version()).lstrip("v")
    RELEASE_DIR.mkdir(parents=True, exist_ok=True)

    portable_html = DIST / "SnapWord-词哒.html"
    attr_txt = DIST / "AUDIO_ATTRIBUTION.txt"
    mp3_files = sorted(AUDIO_DIR.glob("*.mp3"))
    manifest_json = AUDIO_DIR / "attribution.json"

    zip_name = f"SnapWord-词哒-v{version}-离线解压即用包.zip"
    zip_path = RELEASE_DIR / zip_name

    # Remove older zip archives in release/ if superseded? Keep clean or keep versioned?
    # Keep versioned releases or clean same-version zip before writing.
    if zip_path.exists():
        zip_path.unlink()

    root_prefix = "SnapWord-词哒"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        zf.writestr(f"{root_prefix}/启动词哒工作台.cmd", LAUNCHER_CMD.replace("\n", "\r\n"))
        zf.writestr(
            f"{root_prefix}/使用与升级说明.txt",
            build_usage_guide(version, len(mp3_files)).replace("\n", "\r\n"),
        )
        zf.write(portable_html, f"{root_prefix}/SnapWord-词哒.html")
        if manifest_json.exists():
            zf.write(manifest_json, f"{root_prefix}/audio/attribution.json")
        if attr_txt.exists():
            zf.write(attr_txt, f"{root_prefix}/audio/AUDIO_ATTRIBUTION.txt")
        for mp3 in mp3_files:
            zf.write(mp3, f"{root_prefix}/audio/{mp3.name}")

    zip_sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    html_sha = hashlib.sha256(portable_html.read_bytes()).hexdigest()

    # Update SHA256SUMS.txt (append or update entry for current version)
    sums_path = RELEASE_DIR / "SHA256SUMS.txt"
    existing_lines = []
    if sums_path.exists():
        existing_lines = [
            ln for ln in sums_path.read_text(encoding="utf-8").splitlines()
            if ln.strip() and zip_name not in ln and f"v{version} " not in ln
        ]
    existing_lines.append(f"{zip_sha}  {zip_name}")
    existing_lines.append(f"{html_sha}  dist/SnapWord-词哒.html (v{version})")
    sums_path.write_text("\n".join(existing_lines) + "\n", encoding="utf-8")

    (RELEASE_DIR / "README.md").write_text(
        build_release_readme(version, zip_name, zip_sha, html_sha, len(mp3_files)),
        encoding="utf-8",
    )

    size_kb = zip_path.stat().st_size / 1024
    print(f"Packaged release/{zip_name} ({size_kb:.1f} KB, {len(mp3_files)} MP3 clips) | SHA256: {zip_sha}")


if __name__ == "__main__":
    main()
