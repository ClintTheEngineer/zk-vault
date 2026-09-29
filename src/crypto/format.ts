export const MAGIC = new TextEncoder().encode('ZKVAULT1');
export const FORMAT_VERSION = 1;
export const CHUNK_SIZE = 1024 * 1024;

export const RECORD_MANIFEST = 1;
export const RECORD_FILE_CHUNK = 2;
export const RECORD_END = 255;

export interface ManifestEntry {
  path: string;
  size: number;
  lastModified: number;
  type: string;
}

export interface ContainerManifest {
  version: 1;
  createdAt: number;
  entries: ManifestEntry[];
}

export function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

export function readU32be(bytes: Uint8Array, offset = 0): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
