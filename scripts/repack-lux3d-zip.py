#!/usr/bin/env python3
"""
Repack a Lux3D result ZIP into a self-contained, textured GLB.

Lux3D's text/image-to-3D output is a ZIP containing:
    MODEL.glb                              — geometry + placeholder texture
    RawDiffuseFilter.png                   — base colour
    TangentSpaceNormal.png                 — normal
    RawSelfIlluminationFilter.png          — emissive
    RawReflectFilter.png / RawReflectGlossFilter.png   — V-Ray-style PBR (not mapped)
    RawRefractFilter.png / RawRefractGlossFilter.png   — V-Ray-style PBR (not mapped)
    RawFresnelIorFilter.png / Opacity.png  — V-Ray-style PBR (not mapped)

The GLB inside the ZIP does NOT reference any of those PNGs — it embeds a
single 80-byte placeholder, so any standard glTF renderer shows the model as
grey clay. See platform assessment doc (problem 7) for the upstream fix.

This script does the minimum to make the model look like the asset Lux3D
actually generated: it embeds the three PNGs that map cleanly to standard glTF
PBR slots — diffuse / normal / emissive — and rewrites the material to use
them. V-Ray-only channels (reflect / refract / fresnel) are intentionally
skipped; mapping them needs channel composition and is out of scope for a
demo-side workaround.

Usage:
    python scripts/repack-lux3d-zip.py <input.zip> <output.glb>

No external dependencies — stdlib only.
"""

from __future__ import annotations

import io
import json
import struct
import sys
import zipfile
from pathlib import Path

GLB_MAGIC = b"glTF"
GLB_VERSION = 2
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

# Map Aholo's V-Ray-style PNG names → standard glTF PBR slots.
# Order matters: diffuse first so it ends up as image index 0 (replacing the
# original placeholder), then normal, then emissive.
SLOT_MAP: list[tuple[str, str]] = [
    ("RawDiffuseFilter.png", "baseColorTexture"),
    ("TangentSpaceNormal.png", "normalTexture"),
    ("RawSelfIlluminationFilter.png", "emissiveTexture"),
]


def parse_glb(data: bytes) -> tuple[dict, bytes]:
    """Return (gltf_json, bin_chunk) from a GLB blob."""
    magic, version, total = struct.unpack_from("<4sII", data, 0)
    if magic != GLB_MAGIC:
        raise ValueError(f"Not a GLB: magic={magic!r}")
    if version != GLB_VERSION:
        raise ValueError(f"Unsupported GLB version: {version}")
    if total != len(data):
        raise ValueError(f"GLB header length {total} != actual {len(data)}")

    off = 12
    gltf: dict | None = None
    bin_data = b""
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        off += 8
        chunk = data[off : off + clen]
        if ctype == CHUNK_JSON:
            gltf = json.loads(chunk.decode("utf-8"))
        elif ctype == CHUNK_BIN:
            bin_data = chunk
        off += clen

    if gltf is None:
        raise ValueError("GLB has no JSON chunk")
    return gltf, bin_data


def pad_to_4(data: bytes, fill: bytes) -> bytes:
    """Pad to a 4-byte boundary using `fill` (length 1)."""
    remainder = len(data) % 4
    return data if remainder == 0 else data + fill * (4 - remainder)


def write_glb(gltf: dict, bin_data: bytes) -> bytes:
    """Serialise a (json, bin) pair into a GLB."""
    json_bytes = pad_to_4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    bin_bytes = pad_to_4(bin_data, b"\x00")

    out = io.BytesIO()
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    out.write(struct.pack("<4sII", GLB_MAGIC, GLB_VERSION, total))
    out.write(struct.pack("<II", len(json_bytes), CHUNK_JSON))
    out.write(json_bytes)
    out.write(struct.pack("<II", len(bin_bytes), CHUNK_BIN))
    out.write(bin_bytes)
    return out.getvalue()


def append_image(gltf: dict, bin_data: bytearray, png: bytes, slot_name: str) -> int:
    """Append a PNG as a new image, return its image index."""
    # Pad existing BIN to 4-byte boundary so the new bufferView is aligned.
    while len(bin_data) % 4 != 0:
        bin_data.append(0)

    offset = len(bin_data)
    bin_data.extend(png)

    buffer_views = gltf.setdefault("bufferViews", [])
    buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(png)})
    bv_index = len(buffer_views) - 1

    images = gltf.setdefault("images", [])
    images.append({"bufferView": bv_index, "mimeType": "image/png", "name": slot_name})
    img_index = len(images) - 1

    samplers = gltf.setdefault("samplers", [])
    if not samplers:
        # Default sampler: linear filtering + repeat wrapping. Good enough.
        samplers.append({"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497})

    textures = gltf.setdefault("textures", [])
    textures.append({"sampler": 0, "source": img_index})
    return len(textures) - 1


def compute_bbox(gltf: dict, bin_chunk: bytes) -> dict:
    """Local-space AABB across all mesh primitives.

    Lux3D outputs are already centred around the origin with the model's own
    matrix near identity, so we treat the raw POSITION accessor values as the
    bbox directly. (Full node-hierarchy transform composition would be more
    accurate for arbitrary glTF, but adds complexity we don't currently need.)
    """
    accessors = gltf.get("accessors", []) or []
    buffer_views = gltf.get("bufferViews", []) or []
    meshes = gltf.get("meshes", []) or []

    mn = [float("inf")] * 3
    mx = [float("-inf")] * 3

    for mesh in meshes:
        for prim in mesh.get("primitives", []):
            attrs = prim.get("attributes", {})
            pos_idx = attrs.get("POSITION")
            if pos_idx is None or pos_idx >= len(accessors):
                continue
            acc = accessors[pos_idx]
            # POSITION accessors carry min/max per spec — use them when present;
            # they're correct and cheap.
            amin = acc.get("min")
            amax = acc.get("max")
            if isinstance(amin, list) and isinstance(amax, list) and len(amin) == 3 and len(amax) == 3:
                for i in range(3):
                    if amin[i] < mn[i]:
                        mn[i] = float(amin[i])
                    if amax[i] > mx[i]:
                        mx[i] = float(amax[i])
                continue
            # Fallback: decode the buffer ourselves.
            bv_idx = acc.get("bufferView")
            if bv_idx is None or bv_idx >= len(buffer_views):
                continue
            bv = buffer_views[bv_idx]
            count = int(acc.get("count", 0))
            base = int(bv.get("byteOffset", 0)) + int(acc.get("byteOffset", 0))
            stride = int(bv.get("byteStride", 12)) or 12
            for i in range(count):
                off = base + i * stride
                x, y, z = struct.unpack_from("<fff", bin_chunk, off)
                if x < mn[0]: mn[0] = x
                if y < mn[1]: mn[1] = y
                if z < mn[2]: mn[2] = z
                if x > mx[0]: mx[0] = x
                if y > mx[1]: mx[1] = y
                if z > mx[2]: mx[2] = z

    if mn[0] == float("inf"):
        return {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0], "center": [0.0, 0.0, 0.0], "size": [0.0, 0.0, 0.0]}
    center = [(mn[i] + mx[i]) / 2 for i in range(3)]
    size = [mx[i] - mn[i] for i in range(3)]
    return {"min": mn, "max": mx, "center": center, "size": size}


def repack(zip_path: Path, out_path: Path) -> None:
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        glb_names = [n for n in names if n.lower().endswith(".glb")]
        if not glb_names:
            raise ValueError(f"No .glb inside {zip_path}")
        glb_name = glb_names[0]
        glb_bytes = zf.read(glb_name)
        pngs: dict[str, bytes] = {n: zf.read(n) for n in names if n.lower().endswith(".png")}

    gltf, bin_chunk = parse_glb(glb_bytes)
    bin_data = bytearray(bin_chunk)

    materials = gltf.get("materials") or []
    if not materials:
        raise ValueError("GLB has no materials to rewrite")
    material = materials[0]
    pbr = material.setdefault("pbrMetallicRoughness", {})

    # Optional: clear the placeholder factor so the texture's actual colour shows
    # through instead of being tinted 40% grey.
    pbr["baseColorFactor"] = [1.0, 1.0, 1.0, 1.0]
    # Metallic 1.0 looks wrong without proper reflectance maps; dampen it.
    if pbr.get("metallicFactor", 0) >= 0.9:
        pbr["metallicFactor"] = 0.0

    embedded: list[str] = []
    skipped: list[str] = []

    for png_name, slot_name in SLOT_MAP:
        if png_name not in pngs:
            skipped.append(f"{png_name} (not present)")
            continue
        tex_index = append_image(gltf, bin_data, pngs[png_name], slot_name)
        if slot_name == "baseColorTexture":
            pbr["baseColorTexture"] = {"index": tex_index, "texCoord": 0}
        elif slot_name == "normalTexture":
            material["normalTexture"] = {"index": tex_index, "texCoord": 0}
        elif slot_name == "emissiveTexture":
            material["emissiveTexture"] = {"index": tex_index, "texCoord": 0}
            # If emissive is now textured, the emissive factor needs to be > 0.
            if material.get("emissiveFactor", [0, 0, 0]) == [0, 0, 0]:
                material["emissiveFactor"] = [1.0, 1.0, 1.0]
        embedded.append(f"{png_name} → {slot_name}")

    # Update buffer 0's byteLength to match the new BIN.
    buffers = gltf.setdefault("buffers", [{}])
    buffers[0]["byteLength"] = len(bin_data)

    out_bytes = write_glb(gltf, bytes(bin_data))
    out_path.write_bytes(out_bytes)

    # Write a sidecar bbox.json so downstream layout tools (e.g. the LLM
    # auto-layout script) can size + position without reloading the GLB.
    bbox = compute_bbox(gltf, bytes(bin_data))
    bbox_path = out_path.with_suffix(out_path.suffix + ".bbox.json")
    bbox_path.write_text(json.dumps(bbox, indent=2), encoding="utf-8")

    print(f"Wrote {out_path}  ({len(out_bytes):,} bytes)")
    print(f"  bbox: size={tuple(round(s, 3) for s in bbox['size'])} center={tuple(round(c, 3) for c in bbox['center'])} -> {bbox_path.name}")
    print(f"  embedded ({len(embedded)}):")
    for line in embedded:
        print(f"    {line}")
    if skipped:
        print(f"  skipped ({len(skipped)}):")
        for line in skipped:
            print(f"    {line}")
    other_pngs = [n for n in pngs if n not in dict(SLOT_MAP)]
    if other_pngs:
        print(f"  V-Ray-only PNGs not mapped to standard glTF PBR ({len(other_pngs)}):")
        for n in other_pngs:
            print(f"    {n}")


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: repack-lux3d-zip.py <input.zip> <output.glb>", file=sys.stderr)
        return 2
    zip_path = Path(argv[1])
    out_path = Path(argv[2])
    if not zip_path.is_file():
        print(f"input not found: {zip_path}", file=sys.stderr)
        return 1
    out_path.parent.mkdir(parents=True, exist_ok=True)
    repack(zip_path, out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
