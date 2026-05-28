#!/usr/bin/env python3
"""
Finish the cyberpunk pack: for each newly-generated Lux3D task, download the
result ZIP, repack it into a textured GLB (+ bbox sidecar), then append a
catalog entry for it.

Idempotent-ish: it only touches the 7 NEW components defined in MANIFEST and
appends any that aren't already present in the cyberpunk pack. The 2 earlier
components (neon_floor_lamp, holo_monitor_stack) are left as-is.

Usage:
    python scripts/build-cyberpunk-pack.py
"""

from __future__ import annotations

import json
import subprocess
import os
import sys
import urllib.request
from pathlib import Path

KEY = os.environ.get("AHOLO_KEY", "")
if not KEY:
    raise SystemExit("Set AHOLO_KEY env var (your Aholo AppKey).")
GET_URL = "https://api.aholo3d.com/global/lux3d/v1/generate/task/get?taskid={tid}"

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "demos" / "vignette" / "public" / "library" / "cyberpunk"
CATALOG = ROOT / "demos" / "vignette" / "public" / "library" / "catalog.json"
REPACKER = ROOT / "scripts" / "repack-lux3d-zip.py"
TMP = Path("/tmp/lux3d_cyberpunk")

# slot -> metadata. taskId from the submission round on 2026-05-28.
MANIFEST = [
    {
        "tid": 1354361,
        "id": "server_tower",
        "label": "Server Tower",
        "category": "work",
        "realHeight": 0.5,
        "prompt": "a black computer tower PC case with glowing RGB fans, cyberpunk",
    },
    {
        "tid": 1354368,
        "id": "cybernetic_plant",
        "label": "Cybernetic Plant",
        "category": "decor",
        "realHeight": 0.6,
        "prompt": "a small potted plant in a glossy chrome pot with blue LED lights, cyberpunk",
    },
    {
        "tid": 1354374,
        "id": "instant_ramen_pile",
        "label": "Instant Ramen Pile",
        "category": "decor",
        "realHeight": 0.25,
        "prompt": "a neat stack of instant noodle cup containers, cyberpunk",
    },
    {
        "tid": 1354243,
        "id": "crashed_drone",
        "label": "Crashed Drone",
        "category": "decor",
        "realHeight": 0.2,
        "prompt": "a damaged quadcopter drone with exposed circuit boards and one broken propeller, lying on its side, scuffed metal, cyberpunk",
    },
    {
        "tid": 1354380,
        "id": "wall_panel_screen",
        "label": "Wall Panel Screen",
        "category": "decor",
        "realHeight": 0.6,
        "prompt": "a chunky digital information display screen on a thick base stand, glowing blue, cyberpunk",
    },
    {
        "tid": 1354385,
        "id": "utility_crate",
        "label": "Utility Crate",
        "category": "surface",
        "realHeight": 0.45,
        "prompt": "a rugged plastic storage crate, yellow and black industrial, cyberpunk",
    },
    {
        "tid": 1354390,
        "id": "katana_stand",
        "label": "Katana Stand",
        "category": "decor",
        "realHeight": 0.42,
        "prompt": "a decorative blade resting on a wooden display stand with a glowing base, cyberpunk",
    },
    # --- anchor furniture (2026-05-28), simple prompts, for room-aware layout ---
    {
        "tid": 1355928,
        "id": "desk",
        "label": "Desk",
        "category": "surface",
        "realHeight": 0.75,
        "prompt": "a simple black metal computer desk, cyberpunk",
    },
    {
        "tid": 1355933,
        "id": "office_chair",
        "label": "Office Chair",
        "category": "seat",
        "realHeight": 1.1,
        "prompt": "a black office chair, cyberpunk",
    },
    {
        "tid": 1355937,
        "id": "sofa",
        "label": "Sofa",
        "category": "seat",
        "realHeight": 0.8,
        "prompt": "a low modern dark grey sofa, cyberpunk",
    },
]


def fetch_result_url(tid: int) -> str | None:
    url = GET_URL.format(tid=tid)
    req = urllib.request.Request(url, headers={"Authorization": KEY})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    d = data.get("d") or {}
    status = d.get("status")
    if status != 3:
        print(f"  tid={tid} status={status} (not success) — skipping")
        return None
    outputs = d.get("outputs") or []
    if not outputs:
        print(f"  tid={tid} success but no outputs — skipping")
        return None
    return outputs[0].get("content")


def download(url: str, dest: Path) -> None:
    with urllib.request.urlopen(url, timeout=120) as resp:
        dest.write_bytes(resp.read())


def repack(zip_path: Path, glb_path: Path) -> None:
    subprocess.run(
        [sys.executable, str(REPACKER), str(zip_path), str(glb_path)],
        check=True,
    )


def round3(v: float) -> float:
    return round(float(v), 3)


def build_entry(meta: dict, bbox: dict) -> dict:
    return {
        "id": meta["id"],
        "label": meta["label"],
        "category": meta["category"],
        "file": f"/library/cyberpunk/{meta['id']}.glb",
        "prompt": meta["prompt"],
        "style": "cyberpunk",
        "realHeight": meta["realHeight"],
        "bbox": {
            "min": [round3(x) for x in bbox["min"]],
            "max": [round3(x) for x in bbox["max"]],
            "size": [round3(x) for x in bbox["size"]],
            "center": [round3(x) for x in bbox["center"]],
        },
    }


def main() -> int:
    TMP.mkdir(parents=True, exist_ok=True)
    LIB.mkdir(parents=True, exist_ok=True)

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    cyber = next((p for p in catalog["packs"] if p["id"] == "cyberpunk"), None)
    if cyber is None:
        print("ERROR: cyberpunk pack not found in catalog")
        return 1
    existing_ids = {c["id"] for c in cyber["components"]}

    added, skipped, failed = [], [], []
    for meta in MANIFEST:
        slot = meta["id"]
        if slot in existing_ids:
            print(f"{slot}: already in catalog — skipping")
            skipped.append(slot)
            continue
        print(f"{slot}: fetching result URL...")
        try:
            result_url = fetch_result_url(meta["tid"])
            if not result_url:
                failed.append(slot)
                continue
            zip_path = TMP / f"{slot}.zip"
            glb_path = LIB / f"{slot}.glb"
            print(f"{slot}: downloading...")
            download(result_url, zip_path)
            print(f"{slot}: repacking...")
            repack(zip_path, glb_path)
            bbox = json.loads((LIB / f"{slot}.glb.bbox.json").read_text())
            cyber["components"].append(build_entry(meta, bbox))
            added.append(slot)
        except Exception as e:  # noqa: BLE001
            print(f"{slot}: FAILED — {e}")
            failed.append(slot)

    CATALOG.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("\n=== summary ===")
    print(f"added:   {added}")
    print(f"skipped: {skipped}")
    print(f"failed:  {failed}")
    print(f"cyberpunk pack now has {len(cyber['components'])} components")
    return 0 if not failed else 2


if __name__ == "__main__":
    raise SystemExit(main())
