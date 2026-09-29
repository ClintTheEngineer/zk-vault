# Cander ZK Vault — v0.3 prototype

A stateless, client-only, offline-capable file/folder encryption utility.

## What's new in v0.3

- Decryption now reads `.zkv` containers incrementally instead of loading the entire encrypted container into memory.
- Each ciphertext frame is authenticated and decrypted one at a time, then discarded after use.
- Direct folder restoration writes decrypted chunks straight to the destination files as they are processed.
- ZIP generation is incremental and streams directly to a user-selected ZIP file when `showSaveFilePicker()` is available.
- Individual file restoration can also stream directly to disk on browsers that expose a writable save-file handle.
- The initial **Decrypt locally** pass authenticates the complete container while retaining only the encrypted `File` reference and decrypted manifest, not all file payloads.
- `.zkv` **container format v1 is unchanged**, so v0.1/v0.2 containers remain compatible.

No intentional UI, branding, container-format, KDF, or cipher changes were made from v0.2.

## Working vaults

In addition to the original one-shot **Encrypt** workflow, v0.3 includes **Create vault**. Create an empty working vault first, give it a name, then add files and folders from multiple locations before exporting them as one `.zkv` container. Files do not need to be moved into a temporary folder first.

The working vault exists only in the current browser session until export; the existing container format and cryptographic operations are unchanged.

## Security architecture

- Files never need to leave the browser.
- No account, database, API, cookies, analytics, or remote runtime scripts.
- Password derivation: libsodium Argon2id (`crypto_pwhash_ALG_ARGON2ID13`) with MODERATE ops/memory limits.
- Stream encryption: libsodium `crypto_secretstream_xchacha20poly1305`.
- All semantic metadata (name, relative path, MIME type, timestamps, original sizes) is stored in the encrypted manifest.
- The outer `.zkv` filename is random by default.
- Each ciphertext frame is length-prefixed and authenticated as part of one secretstream.
- The final record must authenticate with `TAG_FINAL`; truncation is rejected.
- Encryption and decryption both operate on bounded-size file chunks.
- Direct folder restore writes authenticated plaintext chunks to disk without assembling the full folder in memory.

## Container v1

The `.zkv` on-disk format remains **format v1** in app v0.3. App versions and container-format versions are intentionally independent.

Public prefix:

1. `ZKVAULT1` — 8-byte magic
2. `0x01` — version
3. Argon2id salt (`crypto_pwhash_SALTBYTES`)
4. secretstream header (`crypto_secretstream_xchacha20poly1305_HEADERBYTES`)

Then authenticated secretstream frames:

- 4-byte big-endian ciphertext frame length
- ciphertext frame

Decrypted record types:

- `0x01` manifest: UTF-8 JSON containing relative paths and supported metadata
- `0x02` file chunk: 4-byte file index + raw bytes
- `0xff` end marker with `TAG_FINAL`

Payload chunks remain 1 MiB in format v1.

## v0.3 streaming behavior

### Initial decrypt/authentication

The app performs a complete streaming authentication pass before exposing restore actions. It retains only the manifest and the browser `File` reference. File payload bytes are not accumulated.

### Restore to folder

On browsers with `showDirectoryPicker()`, the `.zkv` file is streamed a second time and each authenticated plaintext chunk is written directly to its destination file. Memory use is therefore essentially independent of the total folder size, aside from the manifest and one active frame/chunk.

### Download as ZIP

The ZIP writer uses uncompressed ZIP entries and computes CRC values incrementally. On browsers with `showSaveFilePicker()`, the ZIP is written directly to disk as it is generated.

On browsers without a writable save-file API, the encrypted input and decrypted file payloads are still processed incrementally, but the completed ZIP output must be buffered in browser memory before the normal download can begin. This is a browser-platform fallback, not a `.zkv` limitation.

Classic ZIP limits still apply in this prototype: up to 65,535 files, individual files smaller than 4 GiB, and a final ZIP smaller than 4 GiB. Direct folder restore does not have those ZIP-specific limits.

### Individual file downloads

Where a writable save-file handle is available, the selected file is streamed directly to disk. Otherwise only that selected plaintext file is buffered for a conventional browser download; the entire `.zkv` container and unrelated files are not buffered.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

The generated `dist/` directory is static and can be served directly by Nginx.

## Before production use

This software is not independently audited. Before describing it as a production cryptographic tool, add deterministic test vectors, corruption/truncation tests, cross-browser tests, CSP headers, dependency pinning, reproducible release hashes/signatures, and an external security review.
