/* URL state — encode the picked variant into the location hash so a
 * scene can be shared by URL. No backend storage in v0.
 */

import type { VariantLayout } from './llm.js';

export function encodeScene(layout: VariantLayout): string {
  const json = JSON.stringify(layout);
  return base64UrlEncode(json);
}

export function decodeScene(hash: string): VariantLayout | null {
  if (!hash) return null;
  try {
    const json = base64UrlDecode(hash);
    return JSON.parse(json) as VariantLayout;
  } catch {
    return null;
  }
}

export function readSceneFromUrl(): VariantLayout | null {
  const h = window.location.hash.replace(/^#/, '');
  if (!h.startsWith('s=')) return null;
  return decodeScene(h.slice(2));
}

export function writeSceneToUrl(layout: VariantLayout): void {
  const enc = encodeScene(layout);
  history.replaceState(null, '', `#s=${enc}`);
}

export function clearSceneUrl(): void {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

function base64UrlEncode(s: string): string {
  const utf8 = new TextEncoder().encode(s);
  let bin = '';
  for (const b of utf8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): string {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  const bin = atob(b);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---- API key persistence ----
const KEY_STORAGE = 'diorama.anthropic_key';

export function getApiKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}

export function setApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}
