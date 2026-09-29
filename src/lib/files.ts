import type { OutputSink, SourceFile } from '../crypto/engine';

export function fromFileList(list: FileList): SourceFile[] {
  return Array.from(list).map((file) => ({
    file,
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }));
}

export function randomContainerName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${token}.zkv`;
}

export async function createDownloadSink(suggestedName: string): Promise<{ sink: OutputSink; mode: 'disk' | 'memory' }> {
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'Cander ZK Vault encrypted container', accept: { 'application/octet-stream': ['.zkv'] } }],
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
        const blob = new Blob(chunks, { type: 'application/octet-stream' });
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

export function downloadBytes(bytes: Uint8Array, filename: string, type = 'application/octet-stream') {
  const blob = new Blob([bytes.slice().buffer], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.split('/').pop() || 'decrypted-file';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
