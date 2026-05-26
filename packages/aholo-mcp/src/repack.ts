/**
 * TypeScript port of `scripts/repack-lux3d-zip.py` — same contract.
 *
 * Lux3D's text/image-to-3D ZIP packages the geometry as a GLB plus 9
 * separate PBR PNGs with V-Ray-style names. The GLB embeds only an 80-byte
 * placeholder texture and does not reference the sibling PNGs, so loading
 * it in a standard glTF renderer shows grey clay.
 *
 * This module unpacks the ZIP, embeds the three PNGs that map cleanly to
 * standard glTF PBR slots (diffuse / normal / emissive), rewrites the
 * material, and emits a self-contained GLB. V-Ray-only channels
 * (reflect / refract / fresnel) are intentionally skipped — they need
 * channel composition that's out of scope here.
 *
 * Reference: see the platform assessment problem 7 and
 * `scripts/repack-lux3d-zip.py` for the canonical commentary.
 */

import { unzipSync, type Unzipped } from 'fflate';

const GLB_MAGIC = new Uint8Array([0x67, 0x6c, 0x54, 0x46]); // "glTF"
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Aholo PNG → standard glTF PBR slot. Order = embed order. */
const SLOT_MAP = [
  ['RawDiffuseFilter.png', 'baseColorTexture'],
  ['TangentSpaceNormal.png', 'normalTexture'],
  ['RawSelfIlluminationFilter.png', 'emissiveTexture'],
] as const;

const ALL_KNOWN_AHOLO_PNGS = new Set([
  'RawDiffuseFilter.png',
  'TangentSpaceNormal.png',
  'RawSelfIlluminationFilter.png',
  'RawReflectFilter.png',
  'RawRefractFilter.png',
  'RawReflectGlossFilter.png',
  'RawRefractGlossFilter.png',
  'RawFresnelIorFilter.png',
  'Opacity.png',
]);

export interface RepackReport {
  embedded: string[];
  skipped: string[];
  vRayOnly: string[];
  outputBytes: number;
}

/** Repack a Lux3D ZIP buffer → textured GLB buffer. */
export function repackLux3DZip(zipBytes: Uint8Array): { glb: Uint8Array; report: RepackReport } {
  const files = unzipSync(zipBytes);
  const glbEntry = Object.entries(files).find(([n]) => n.toLowerCase().endsWith('.glb'));
  if (!glbEntry) throw new Error('No .glb inside the ZIP');
  const [glbName, glbBytes] = glbEntry;
  void glbName;

  const pngs: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) {
    if (name.toLowerCase().endsWith('.png')) pngs[name] = bytes;
  }

  const { json: gltf, bin } = parseGlb(glbBytes);

  const materials = (gltf.materials ?? []) as MaterialDef[];
  if (materials.length === 0) throw new Error('GLB has no materials to rewrite');
  const material = materials[0];
  const pbr = (material.pbrMetallicRoughness ??= {});

  // Let the embedded texture's actual colour show through instead of being
  // tinted 40% grey, and drop the surprise-100%-metal default.
  pbr.baseColorFactor = [1, 1, 1, 1];
  if ((pbr.metallicFactor ?? 0) >= 0.9) pbr.metallicFactor = 0;

  const binParts: Uint8Array[] = [bin];
  let binLength = bin.length;

  const embedded: string[] = [];
  const skipped: string[] = [];

  for (const [pngName, slot] of SLOT_MAP) {
    const png = pngs[pngName];
    if (!png) {
      skipped.push(`${pngName} (not in ZIP)`);
      continue;
    }
    // 4-byte align before appending.
    const pad = (4 - (binLength % 4)) % 4;
    if (pad > 0) {
      binParts.push(new Uint8Array(pad));
      binLength += pad;
    }
    const byteOffset = binLength;
    binParts.push(png);
    binLength += png.length;

    const bufferViews = (gltf.bufferViews ??= [] as BufferViewDef[]);
    bufferViews.push({ buffer: 0, byteOffset, byteLength: png.length });
    const bvIndex = bufferViews.length - 1;

    const images = (gltf.images ??= [] as ImageDef[]);
    images.push({ bufferView: bvIndex, mimeType: 'image/png', name: slot });
    const imgIndex = images.length - 1;

    const samplers = (gltf.samplers ??= [] as SamplerDef[]);
    if (samplers.length === 0) {
      samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
    }

    const textures = (gltf.textures ??= [] as TextureDef[]);
    textures.push({ sampler: 0, source: imgIndex });
    const texIndex = textures.length - 1;

    if (slot === 'baseColorTexture') {
      pbr.baseColorTexture = { index: texIndex, texCoord: 0 };
    } else if (slot === 'normalTexture') {
      material.normalTexture = { index: texIndex, texCoord: 0 };
    } else if (slot === 'emissiveTexture') {
      material.emissiveTexture = { index: texIndex, texCoord: 0 };
      const ef = material.emissiveFactor;
      if (!ef || (ef[0] === 0 && ef[1] === 0 && ef[2] === 0)) {
        material.emissiveFactor = [1, 1, 1];
      }
    }
    embedded.push(`${pngName} → ${slot}`);
  }

  // Update buffer 0 byteLength.
  const buffers = (gltf.buffers ??= [{}] as BufferDef[]);
  if (buffers.length === 0) buffers.push({});
  buffers[0].byteLength = binLength;

  const newBin = concatU8(binParts);
  const glbOut = serialiseGlb(gltf, newBin);

  const vRayOnly = Object.keys(pngs).filter(
    (n) => ALL_KNOWN_AHOLO_PNGS.has(n) && !SLOT_MAP.some(([m]) => m === n)
  );

  return {
    glb: glbOut,
    report: { embedded, skipped, vRayOnly, outputBytes: glbOut.length },
  };
}

// ---------- GLB parsing / serialisation ----------

interface ParsedGlb {
  json: GltfRoot;
  bin: Uint8Array;
}

interface GltfRoot {
  buffers?: BufferDef[];
  bufferViews?: BufferViewDef[];
  images?: ImageDef[];
  samplers?: SamplerDef[];
  textures?: TextureDef[];
  materials?: MaterialDef[];
  [k: string]: unknown;
}

interface BufferDef {
  byteLength?: number;
  [k: string]: unknown;
}
interface BufferViewDef {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  [k: string]: unknown;
}
interface ImageDef {
  bufferView?: number;
  mimeType?: string;
  uri?: string;
  name?: string;
  [k: string]: unknown;
}
interface SamplerDef {
  magFilter?: number;
  minFilter?: number;
  wrapS?: number;
  wrapT?: number;
  [k: string]: unknown;
}
interface TextureDef {
  sampler?: number;
  source?: number;
  [k: string]: unknown;
}
interface TextureRef {
  index: number;
  texCoord?: number;
}
interface MaterialDef {
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    baseColorTexture?: TextureRef;
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTexture?: TextureRef;
    [k: string]: unknown;
  };
  normalTexture?: TextureRef & { scale?: number };
  emissiveTexture?: TextureRef;
  emissiveFactor?: [number, number, number];
  [k: string]: unknown;
}

function parseGlb(data: Uint8Array): ParsedGlb {
  if (data.length < 12) throw new Error('GLB too short');
  for (let i = 0; i < 4; i++) {
    if (data[i] !== GLB_MAGIC[i]) throw new Error('Not a GLB (bad magic)');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint32(4, true);
  if (version !== GLB_VERSION) throw new Error(`Unsupported GLB version: ${version}`);
  const total = view.getUint32(8, true);
  if (total !== data.length) {
    throw new Error(`GLB header length ${total} != actual ${data.length}`);
  }

  let off = 12;
  let json: GltfRoot | undefined;
  let bin: Uint8Array = new Uint8Array(0);
  while (off < data.length) {
    const clen = view.getUint32(off, true);
    const ctype = view.getUint32(off + 4, true);
    off += 8;
    const chunk = data.subarray(off, off + clen);
    if (ctype === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder('utf-8').decode(chunk)) as GltfRoot;
    } else if (ctype === CHUNK_BIN) {
      bin = chunk;
    }
    off += clen;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

function serialiseGlb(gltf: GltfRoot, bin: Uint8Array): Uint8Array {
  const jsonStr = JSON.stringify(gltf);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  // Pad JSON to 4-byte boundary with spaces, BIN with zeros — per GLB spec.
  const jsonPadded = padTo4(jsonBytes, 0x20);
  const binPadded = padTo4(bin, 0x00);

  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(GLB_MAGIC, 0);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, total, true);

  let off = 12;
  view.setUint32(off, jsonPadded.length, true);
  view.setUint32(off + 4, CHUNK_JSON, true);
  out.set(jsonPadded, off + 8);
  off += 8 + jsonPadded.length;

  view.setUint32(off, binPadded.length, true);
  view.setUint32(off + 4, CHUNK_BIN, true);
  out.set(binPadded, off + 8);

  return out;
}

function padTo4(data: Uint8Array, fill: number): Uint8Array {
  const remainder = data.length % 4;
  if (remainder === 0) return data;
  const padded = new Uint8Array(data.length + (4 - remainder));
  padded.set(data, 0);
  padded.fill(fill, data.length);
  return padded;
}

function concatU8(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

void (null as Unzipped | null); // keep the unused-import-as-type alive for future use
