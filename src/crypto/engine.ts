import sodium from 'libsodium-wrappers-sumo';
import {
  CHUNK_SIZE,
  ContainerManifest,
  FORMAT_VERSION,
  MAGIC,
  RECORD_END,
  RECORD_FILE_CHUNK,
  RECORD_MANIFEST,
  concat,
  readU32be,
  u32be,
} from './format';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAX_MANIFEST_FRAME = 64 * 1024 * 1024;
const MAX_FILE_FRAME = CHUNK_SIZE + 128;

export interface SourceFile {
  file: File;
  path: string;
}

export interface ProgressInfo {
  phase: 'deriving-key' | 'encrypting' | 'decrypting' | 'done';
  processed: number;
  total: number;
  current?: string;
}

export interface OutputSink {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

async function ready() {
  await sodium.ready;
}

function deriveKey(password: string, salt: Uint8Array): Uint8Array {
  return sodium.crypto_pwhash(
    sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES,
    password,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
    'uint8array',
  );
}

function buildManifest(files: SourceFile[]): ContainerManifest {
  return {
    version: 1,
    createdAt: Date.now(),
    entries: files.map(({ file, path }) => ({
      path,
      size: file.size,
      lastModified: file.lastModified,
      type: file.type,
    })),
  };
}

async function writeFrame(
  sink: OutputSink,
  state: unknown,
  plaintext: Uint8Array,
  tag: number,
): Promise<void> {
  const cipher = sodium.crypto_secretstream_xchacha20poly1305_push(
    state as never,
    plaintext,
    null,
    tag,
    'uint8array',
  );
  await sink.write(u32be(cipher.length));
  await sink.write(cipher);
}

export async function encryptToSink(
  files: SourceFile[],
  password: string,
  sink: OutputSink,
  onProgress?: (info: ProgressInfo) => void,
): Promise<void> {
  if (!files.length) throw new Error('No files selected.');
  if (!password) throw new Error('Password is required.');

  await ready();
  const total = files.reduce((sum, item) => sum + item.file.size, 0);
  onProgress?.({ phase: 'deriving-key', processed: 0, total });

  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const key = deriveKey(password, salt);
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);

  await sink.write(MAGIC);
  await sink.write(new Uint8Array([FORMAT_VERSION]));
  await sink.write(salt);
  await sink.write(header);

  const manifestBytes = textEncoder.encode(JSON.stringify(buildManifest(files)));
  await writeFrame(
    sink,
    state,
    concat(new Uint8Array([RECORD_MANIFEST]), manifestBytes),
    sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
  );

  let processed = 0;
  for (let index = 0; index < files.length; index++) {
    const source = files[index];
    let offset = 0;
    while (offset < source.file.size) {
      const end = Math.min(offset + CHUNK_SIZE, source.file.size);
      const bytes = new Uint8Array(await source.file.slice(offset, end).arrayBuffer());
      const record = concat(new Uint8Array([RECORD_FILE_CHUNK]), u32be(index), bytes);
      await writeFrame(
        sink,
        state,
        record,
        sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
      );
      offset = end;
      processed += bytes.length;
      onProgress?.({ phase: 'encrypting', processed, total, current: source.path });
    }
  }

  await writeFrame(
    sink,
    state,
    new Uint8Array([RECORD_END]),
    sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
  );
  sodium.memzero(key);
  await sink.close();
  onProgress?.({ phase: 'done', processed: total, total });
}

class BlobReader {
  private offset = 0;

  constructor(private blob: Blob) {}

  async take(length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.blob.size) {
      throw new Error('Truncated encrypted container.');
    }
    const out = new Uint8Array(await this.blob.slice(this.offset, this.offset + length).arrayBuffer());
    if (out.length !== length) throw new Error('Truncated encrypted container.');
    this.offset += length;
    return out;
  }

  remaining(): number {
    return this.blob.size - this.offset;
  }

  position(): number {
    return this.offset;
  }
}

export interface DecryptedBundle {
  manifest: ContainerManifest;
  container: File;
}

export interface StreamHandlers {
  onManifest?(manifest: ContainerManifest): Promise<void> | void;
  onFileChunk?(index: number, bytes: Uint8Array, manifest: ContainerManifest): Promise<void> | void;
}

function validateManifest(value: unknown): ContainerManifest {
  if (!value || typeof value !== 'object') throw new Error('Encrypted manifest is invalid.');
  const manifest = value as Partial<ContainerManifest>;
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error('Encrypted manifest is invalid.');
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error('Encrypted manifest contains an invalid file entry.');
    }
  }
  return manifest as ContainerManifest;
}

/**
 * Incrementally reads and authenticates a .zkv container. At most one encrypted
 * frame plus its plaintext is resident because of the parser itself. The manifest
 * remains in memory, but file payloads are handed to the caller and then discarded.
 */
export async function streamDecryptedContainer(
  container: File,
  password: string,
  handlers: StreamHandlers = {},
  onProgress?: (info: ProgressInfo) => void,
): Promise<ContainerManifest> {
  if (!password) throw new Error('Password is required.');
  await ready();
  onProgress?.({ phase: 'deriving-key', processed: 0, total: container.size });

  const reader = new BlobReader(container);
  const magic = await reader.take(MAGIC.length);
  if (!sodium.memcmp(magic, MAGIC)) throw new Error('Not a Cander ZK Vault container.');
  const version = (await reader.take(1))[0];
  if (version !== FORMAT_VERSION) throw new Error(`Unsupported container version: ${version}`);

  const salt = await reader.take(sodium.crypto_pwhash_SALTBYTES);
  const header = await reader.take(sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES);
  const key = deriveKey(password, salt);
  const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key);

  let manifest: ContainerManifest | undefined;
  let sawFinal = false;
  let lastFileIndex = -1;
  let sizes: number[] | undefined;

  try {
    while (reader.remaining() > 0) {
      if (sawFinal) throw new Error('Container has trailing data after the authenticated final record.');
      const frameLength = readU32be(await reader.take(4));
      if (frameLength <= 0 || frameLength > MAX_MANIFEST_FRAME) throw new Error('Encrypted frame length is invalid.');
      const frame = await reader.take(frameLength);
      const pulled = sodium.crypto_secretstream_xchacha20poly1305_pull(state, frame, null, 'uint8array');
      if (!pulled) throw new Error('Authentication failed. Wrong password or corrupted container.');

      const message = pulled.message as Uint8Array;
      if (!message.length) throw new Error('Encrypted record is empty.');
      const recordType = message[0];

      if (recordType === RECORD_MANIFEST) {
        if (manifest) throw new Error('Container contains more than one manifest.');
        if (pulled.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) throw new Error('Manifest cannot be the final record.');
        manifest = validateManifest(JSON.parse(textDecoder.decode(message.slice(1))) as unknown);
        sizes = new Array(manifest.entries.length).fill(0);
        await handlers.onManifest?.(manifest);
      } else if (recordType === RECORD_FILE_CHUNK) {
        if (!manifest || !sizes) throw new Error('File data appeared before the encrypted manifest.');
        if (frameLength > MAX_FILE_FRAME) throw new Error('Encrypted file chunk exceeds the format chunk limit.');
        if (message.length < 5) throw new Error('Encrypted file chunk is malformed.');
        if (pulled.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) throw new Error('File chunk cannot be the final record.');
        const index = readU32be(message, 1);
        if (index >= manifest.entries.length) throw new Error('Encrypted file chunk references an invalid file index.');
        if (index < lastFileIndex) throw new Error('Encrypted file chunks are out of order.');
        lastFileIndex = index;
        const bytes = message.slice(5);
        sizes[index] += bytes.length;
        if (sizes[index] > manifest.entries[index].size) throw new Error(`Size mismatch for ${manifest.entries[index].path}.`);
        await handlers.onFileChunk?.(index, bytes, manifest);
      } else if (recordType === RECORD_END) {
        if (!manifest || !sizes) throw new Error('Encrypted manifest is missing.');
        if (message.length !== 1) throw new Error('Final record is malformed.');
        if (pulled.tag !== sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) throw new Error('Container final record is not authenticated as final.');
        sawFinal = true;
      } else {
        throw new Error('Unknown encrypted record type.');
      }

      onProgress?.({ phase: 'decrypting', processed: reader.position(), total: container.size });
    }
  } finally {
    sodium.memzero(key);
  }

  if (!manifest || !sizes) throw new Error('Encrypted manifest is missing.');
  if (!sawFinal) throw new Error('Container ended without an authenticated final record.');
  for (let index = 0; index < manifest.entries.length; index++) {
    if (sizes[index] !== manifest.entries[index].size) throw new Error(`Size mismatch for ${manifest.entries[index].path}.`);
  }

  onProgress?.({ phase: 'done', processed: container.size, total: container.size });
  return manifest;
}

export async function decryptFromFile(
  container: File,
  password: string,
  onProgress?: (info: ProgressInfo) => void,
): Promise<DecryptedBundle> {
  // Authenticate the complete container incrementally, but retain only the encrypted
  // File handle and decrypted manifest. Payload bytes are deliberately discarded.
  const manifest = await streamDecryptedContainer(container, password, {}, onProgress);
  return { manifest, container };
}
