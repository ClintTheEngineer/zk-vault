import { streamDecryptedContainer, type DecryptedBundle, type OutputSink, type ProgressInfo } from '../crypto/engine';

function normalizePath(path: string): string[] {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..' || part.includes('\0'))) {
    throw new Error(`Unsafe path in encrypted container: ${path}`);
  }
  return parts;
}

function u16le(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32le(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function dosDateTime(ms: number): { date: number; time: number } {
  const d = new Date(ms || Date.now());
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { date, time };
}

function crc32Update(crc: number, bytes: Uint8Array): number {
  let value = crc;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return value >>> 0;
}

interface DirectoryHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<WritableHandle>;
  }>;
}

interface WritableHandle {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

type FilePickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<{ createWritable(): Promise<WritableHandle> }>;
};

export function canRestoreToFolder(): boolean {
  return typeof (window as FilePickerWindow).showDirectoryPicker === 'function';
}

async function openPath(root: DirectoryHandle, path: string): Promise<WritableHandle> {
  const parts = normalizePath(path);
  const filename = parts.pop();
  if (!filename) throw new Error(`Invalid file path: ${path}`);
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  const file = await dir.getFileHandle(filename, { create: true });
  return file.createWritable();
}

export async function restoreBundleToFolder(
  bundle: DecryptedBundle,
  password: string,
  onProgress?: (info: ProgressInfo) => void,
): Promise<void> {
  const picker = (window as FilePickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('Direct folder restore is not supported by this browser. Use Download as ZIP instead.');

  const root = await picker({ mode: 'readwrite' });
  let activeIndex = -1;
  const writeState: { writable: WritableHandle | null } = { writable: null };
  let nextIndex = 0;

  async function createEmptyThrough(exclusiveIndex: number) {
    while (nextIndex < exclusiveIndex) {
      const empty = await openPath(root, bundle.manifest.entries[nextIndex].path);
      await empty.close();
      nextIndex++;
    }
  }

  try {
    await streamDecryptedContainer(bundle.container, password, {
      async onFileChunk(index, bytes) {
        if (index !== activeIndex) {
          if (writeState.writable) await writeState.writable.close();
          await createEmptyThrough(index);
          writeState.writable = await openPath(root, bundle.manifest.entries[index].path);
          activeIndex = index;
          nextIndex = index + 1;
        }
        await writeState.writable!.write(bytes as unknown as BufferSource);
      },
    }, onProgress);
    if (writeState.writable) await writeState.writable.close();
    writeState.writable = null;
    await createEmptyThrough(bundle.manifest.entries.length);
  } catch (error) {
    if (writeState.writable?.abort) await writeState.writable.abort(error).catch(() => undefined);
    throw error;
  }
}

interface ZipCentralEntry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  date: number;
  time: number;
}

class CountingSink {
  count = 0;
  constructor(private inner: OutputSink) {}
  async write(bytes: Uint8Array) {
    await this.inner.write(bytes);
    this.count += bytes.length;
  }
  async close() { await this.inner.close(); }
}

async function createZipOutputSink(suggestedName: string): Promise<{ sink: OutputSink; mode: 'disk' | 'memory' }> {
  const picker = (window as FilePickerWindow).showSaveFilePicker;
  if (picker) {
    const handle = await picker({
      suggestedName,
      types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
    });
    const writable = await handle.createWritable();
    return {
      mode: 'disk',
      sink: {
        async write(data) { await writable.write(data as unknown as BufferSource); },
        async close() { await writable.close(); },
      },
    };
  }

  const chunks: BlobPart[] = [];
  return {
    mode: 'memory',
    sink: {
      async write(data) { chunks.push(data.slice().buffer); },
      async close() {
        const blob = new Blob(chunks, { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = suggestedName;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
    },
  };
}

function ensureClassicZipLimits(bundle: DecryptedBundle) {
  if (bundle.manifest.entries.length > 0xffff) throw new Error('ZIP fallback currently supports up to 65,535 files.');
  let estimated = 22;
  const encoder = new TextEncoder();
  for (const entry of bundle.manifest.entries) {
    if (entry.size > 0xffffffff) throw new Error('ZIP fallback currently supports files smaller than 4 GiB.');
    const nameLength = encoder.encode(normalizePath(entry.path).join('/')).length;
    estimated += entry.size + 30 + nameLength + 16 + 46 + nameLength;
    if (estimated > 0xffffffff) throw new Error('ZIP fallback currently supports archives smaller than 4 GiB.');
  }
}

export async function downloadZip(
  bundle: DecryptedBundle,
  password: string,
  suggestedName = 'decrypted-folder.zip',
  onProgress?: (info: ProgressInfo) => void,
): Promise<void> {
  ensureClassicZipLimits(bundle);
  const { sink: rawSink, mode } = await createZipOutputSink(suggestedName);
  const sink = new CountingSink(rawSink);
  const encoder = new TextEncoder();
  const central: ZipCentralEntry[] = [];
  let activeIndex = -1;
  let crc = 0xffffffff;
  let size = 0;
  let currentOffset = 0;
  let currentName = new Uint8Array();
  let currentDate = 0;
  let currentTime = 0;
  let nextIndex = 0;

  async function beginEntry(index: number) {
    const meta = bundle.manifest.entries[index];
    const path = normalizePath(meta.path).join('/');
    const name = encoder.encode(path);
    if (name.length > 0xffff) throw new Error(`Path is too long for ZIP: ${path}`);
    const dt = dosDateTime(meta.lastModified);
    activeIndex = index;
    crc = 0xffffffff;
    size = 0;
    currentOffset = sink.count;
    currentName = name;
    currentDate = dt.date;
    currentTime = dt.time;
    const flags = 0x0808; // UTF-8 + data descriptor
    await sink.write(concat([
      u32le(0x04034b50), u16le(20), u16le(flags), u16le(0), u16le(currentTime), u16le(currentDate),
      u32le(0), u32le(0), u32le(0), u16le(name.length), u16le(0), name,
    ]));
  }

  async function finishEntry() {
    if (activeIndex < 0) return;
    const finalCrc = (crc ^ 0xffffffff) >>> 0;
    await sink.write(concat([u32le(0x08074b50), u32le(finalCrc), u32le(size), u32le(size)]));
    central.push({ name: currentName, crc: finalCrc, size, offset: currentOffset, date: currentDate, time: currentTime });
    activeIndex = -1;
  }

  async function createEmptyThrough(exclusiveIndex: number) {
    while (nextIndex < exclusiveIndex) {
      await beginEntry(nextIndex);
      await finishEntry();
      nextIndex++;
    }
  }

  await streamDecryptedContainer(bundle.container, password, {
    async onFileChunk(index, bytes) {
      if (index !== activeIndex) {
        await finishEntry();
        await createEmptyThrough(index);
        await beginEntry(index);
        nextIndex = index + 1;
      }
      crc = crc32Update(crc, bytes);
      size += bytes.length;
      await sink.write(bytes);
    },
  }, onProgress);

  await finishEntry();
  await createEmptyThrough(bundle.manifest.entries.length);

  const centralOffset = sink.count;
  const flags = 0x0808;
  for (const item of central) {
    await sink.write(concat([
      u32le(0x02014b50), u16le(20), u16le(20), u16le(flags), u16le(0), u16le(item.time), u16le(item.date),
      u32le(item.crc), u32le(item.size), u32le(item.size), u16le(item.name.length), u16le(0), u16le(0),
      u16le(0), u16le(0), u32le(0), u32le(item.offset), item.name,
    ]));
  }
  const centralSize = sink.count - centralOffset;
  await sink.write(concat([
    u32le(0x06054b50), u16le(0), u16le(0), u16le(central.length), u16le(central.length),
    u32le(centralSize), u32le(centralOffset), u16le(0),
  ]));
  await sink.close();

  if (mode === 'memory') {
    // The encrypted input and decrypted files are still streamed. Only the final ZIP
    // is buffered on browsers that cannot expose a writable download file handle.
  }
}

export async function downloadDecryptedFile(
  bundle: DecryptedBundle,
  password: string,
  index: number,
  onProgress?: (info: ProgressInfo) => void,
): Promise<void> {
  const meta = bundle.manifest.entries[index];
  if (!meta) throw new Error('File does not exist in the decrypted manifest.');
  const suggestedName = normalizePath(meta.path).pop() || 'decrypted-file';
  const picker = (window as FilePickerWindow).showSaveFilePicker;

  if (picker) {
    const handle = await picker({ suggestedName });
    const writable = await handle.createWritable();
    try {
      await streamDecryptedContainer(bundle.container, password, {
        async onFileChunk(fileIndex, bytes) {
          if (fileIndex === index) await writable.write(bytes as unknown as BufferSource);
        },
      }, onProgress);
      await writable.close();
    } catch (error) {
      if (writable.abort) await writable.abort(error).catch(() => undefined);
      throw error;
    }
    return;
  }

  const chunks: BlobPart[] = [];
  await streamDecryptedContainer(bundle.container, password, {
    onFileChunk(fileIndex, bytes) {
      if (fileIndex === index) chunks.push(bytes.slice().buffer);
    },
  }, onProgress);
  const blob = new Blob(chunks, { type: meta.type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function bundleDisplayName(bundle: DecryptedBundle): string {
  const entries = bundle.manifest.entries;
  if (!entries.length) return 'Decrypted contents';
  const paths = entries.map(({ path }) => normalizePath(path));
  const first = paths[0][0];
  if (first && paths.every((parts) => parts[0] === first) && paths.some((parts) => parts.length > 1)) return first;
  if (entries.length === 1) return paths[0].join('/');
  return `${entries.length} files`;
}

export function zipNameForBundle(bundle: DecryptedBundle): string {
  const name = bundleDisplayName(bundle).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'decrypted-folder';
  return `${name}.zip`;
}
