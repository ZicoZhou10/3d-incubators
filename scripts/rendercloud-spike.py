#!/usr/bin/env python3
"""
RenderCloud spike — build a minimal USDA from registered asset meshIds, submit
an offline render job, poll, and download the resulting PNG.

Scene is expressed in OUR metric Y-up world coordinates (same frame as the
in-browser viewer). RenderCloud ignores upAxis and just consumes the baked
matrices, so we transpose our column-vector TRS / look-at matrices into USD's
row-vector `matrix4d xformOp:transform`.

Usage:
    python scripts/rendercloud-spike.py            # uses SCENE below
No external deps (pure stdlib; matrix math by hand).
"""
from __future__ import annotations
import base64, json, math, os, time, urllib.request
from pathlib import Path

KEY = os.environ.get("AHOLO_KEY", "")
if not KEY:
    raise SystemExit("Set AHOLO_KEY env var (your Aholo AppKey).")
BASE = "https://api.aholo3d.com/global/rendercloud/v1"
OUT = Path(__file__).resolve().parent.parent / ".tmp"

# ---- fill these from mesh-upload-process results ----
SCENE = {
    "splat": {"meshId": "YYUWSZRVAJTD4PTUJQ888888", "translate": [3.284, 1.867, 0.334], "euler": [-math.pi / 2, 0, 0], "scale": 2.4},
    "meshes": [
        # {"name":"desk","meshId":123,"translate":[x,y,z],"euler":[0,ry,0],"scale":s},
    ],
    "camera": {"eye": [3.507, 1.223, 0.774], "target": [0, 1.0, 0], "up": [0, 1, 0],
               "focalLength": 28.0, "hAperture": 24.447, "vAperture": 13.75},
    "resolution": [1280, 720],
}

# ---------- pure-python 4x4 matrix math (column-vector convention) ----------
def matmul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

def ident():
    return [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]

def transpose(m):
    return [[m[j][i] for j in range(4)] for i in range(4)]

def rot_x(t):
    c, s = math.cos(t), math.sin(t)
    return [[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]]

def rot_y(t):
    c, s = math.cos(t), math.sin(t)
    return [[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]]

def rot_z(t):
    c, s = math.cos(t), math.sin(t)
    return [[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]

def world_matrix(translate, euler, scale):
    """Column-vector M = T @ R @ S (single-axis rotations, so XYZ order is moot)."""
    s = [[scale, 0, 0, 0], [0, scale, 0, 0], [0, 0, scale, 0], [0, 0, 0, 1]]
    r = matmul(matmul(rot_x(euler[0]), rot_y(euler[1])), rot_z(euler[2]))
    t = ident()
    t[0][3], t[1][3], t[2][3] = translate
    return matmul(matmul(t, r), s)

def look_at(eye, target, up):
    """Camera-to-world (column-vector); USD camera looks down -Z."""
    def sub(a, b): return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
    def cross(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    def norm(a):
        L = math.sqrt(sum(x * x for x in a)) or 1.0
        return [x / L for x in a]
    f = norm(sub(target, eye))
    r = norm(cross(f, up))
    u = cross(r, f)
    return [
        [r[0], u[0], -f[0], eye[0]],
        [r[1], u[1], -f[1], eye[1]],
        [r[2], u[2], -f[2], eye[2]],
        [0, 0, 0, 1],
    ]

def usd_mat(colvec_m):
    """USD row-vector matrix = transpose of our column-vector matrix."""
    return transpose(colvec_m)

def fmt_mat(m):
    rows = ",\n        ".join("(" + ", ".join(f"{v:.6f}" for v in row) + ")" for row in m)
    return f"(\n        {rows}\n    )"

# ---------- USDA builder ----------
def build_usda(scene) -> str:
    parts = ['#usda 1.0', '(', '    defaultPrim = "World"', ')', '', 'def Xform "World"', '{']
    sp = scene["splat"]
    if sp and sp.get("meshId") is not None:
        m = usd_mat(world_matrix(sp["translate"], sp["euler"], sp["scale"]))
        parts += [
            f'    def ParticleField3DGaussianSplat "RoomSplat" (',
            f'        payload = @manycore:/mesh/{sp["meshId"]}@</GaussianSplatData>',
            f'    )',
            f'    {{',
            f'        matrix4d xformOp:transform = {fmt_mat(m)}',
            f'        uniform token[] xformOpOrder = ["xformOp:transform"]',
            f'    }}',
        ]
    for i, me in enumerate(scene.get("meshes", [])):
        m = usd_mat(world_matrix(me["translate"], me["euler"], me["scale"]))
        nm = me.get("name", f"Mesh{i}")
        parts += [
            f'    def Mesh "{nm}" (',
            f'        payload = @manycore:/mesh/{me["meshId"]}@</mesh>',
            f'    )',
            f'    {{',
            f'        matrix4d xformOp:transform = {fmt_mat(m)}',
            f'        uniform token[] xformOpOrder = ["xformOp:transform"]',
            f'    }}',
        ]
    cam = scene["camera"]
    cm = usd_mat(look_at(cam["eye"], cam["target"], cam["up"]))
    parts += [
        '    def Xform "Cameras"',
        '    {',
        '        def Camera "MainCamera"',
        '        {',
        '            token projection = "perspective"',
        '            float2 clippingRange = (0.05, 1000)',
        f'            float focalLength = {cam["focalLength"]}',
        f'            float horizontalAperture = {cam["hAperture"]}',
        f'            float verticalAperture = {cam["vAperture"]}',
        f'            matrix4d xformOp:transform = {fmt_mat(cm)}',
        '            uniform token[] xformOpOrder = ["xformOp:transform"]',
        '        }',
        '    }',
        '}',
        '',
        'def Scope "Render"',
        '{',
        '    def RenderSettings "MainRenderSettings"',
        '    {',
        '        rel camera = </World/Cameras/MainCamera>',
        f'        int2 resolution = ({scene["resolution"][0]}, {scene["resolution"][1]})',
        '    }',
        '}',
        '',
    ]
    return "\n".join(parts)

# ---------- submit + poll ----------
def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                headers={"Authorization": KEY, "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())

def main():
    OUT.mkdir(exist_ok=True)
    usda = build_usda(SCENE)
    (OUT / "spike.usda").write_text(usda, encoding="utf-8")
    print("USDA written to .tmp/spike.usda (", len(usda), "chars )")
    if SCENE["splat"]["meshId"] is None and not SCENE["meshes"]:
        print("No meshIds set — fill SCENE and rerun.")
        return
    enc = base64.b64encode(usda.encode("utf-8")).decode()
    resp = post(f"{BASE}/jobs", {"requestId": f"spike-{int(time.time())}", "usdContent": enc})
    print("submit:", json.dumps(resp)[:400])
    op = resp.get("d") or resp
    op_id = op.get("operationId") or op.get("id") or (op.get("metadata") or {}).get("operationId")
    if not op_id:
        print("no operationId; full resp:", json.dumps(resp)[:800]); return
    print("operationId:", op_id)
    for _ in range(120):
        time.sleep(5)
        r = post(f"{BASE}/jobs", {"operationId": op_id})
        d = r.get("d") or r
        done = d.get("done")
        print("poll done=", done, json.dumps(d)[:200])
        if done:
            result = d.get("result") or {}
            url = result.get("resultUrl") or result.get("url")
            print("RESULT:", url)
            if url:
                img = OUT / "spike_render.png"
                img.write_bytes(urllib.request.urlopen(url, timeout=120).read())
                print("downloaded ->", img)
            return
    print("timed out")

if __name__ == "__main__":
    main()
