import { useMemo, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { decryptFromFile, encryptToSink, type DecryptedBundle, type ProgressInfo, type SourceFile } from './crypto/engine';
import { createDownloadSink, fromFileList, randomContainerName } from './lib/files';
import { bundleDisplayName, canRestoreToFolder, downloadDecryptedFile, downloadZip, restoreBundleToFolder, zipNameForBundle } from './lib/restore';
import './styles.css';

type Mode = 'encrypt' | 'vault' | 'decrypt';

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function Progress({ info }: { info?: ProgressInfo }) {
  if (!info) return null;
  const pct = info.total ? Math.min(100, Math.round((info.processed / info.total) * 100)) : 0;
  const label = info.phase === 'deriving-key' ? 'Deriving encryption key…' : info.phase === 'done' ? 'Complete' : `${info.phase === 'encrypting' ? 'Encrypting' : 'Decrypting'}…`;
  return (
    <div className="progress-wrap" aria-live="polite">
      <div className="progress-label"><span>{label}</span><span>{info.phase === 'deriving-key' ? '' : `${pct}%`}</span></div>
      <div className="progress"><div className="progress-bar" style={{ width: `${info.phase === 'deriving-key' ? 8 : pct}%` }} /></div>
      {info.current && <div className="muted ellipsis">{info.current}</div>}
    </div>
  );
}

function mergeSources(existing: SourceFile[], incoming: SourceFile[]): SourceFile[] {
  const seen = new Set(existing.map((source) => `${source.path}\u0000${source.file.size}\u0000${source.file.lastModified}`));
  const merged = [...existing];
  for (const source of incoming) {
    const key = `${source.path}\u0000${source.file.size}\u0000${source.file.lastModified}`;
    if (!seen.has(key)) {
      merged.push(source);
      seen.add(key);
    }
  }
  return merged;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('encrypt');
  const [sources, setSources] = useState<SourceFile[]>([]);
  const [vaultSources, setVaultSources] = useState<SourceFile[]>([]);
  const [vaultName, setVaultName] = useState('My Vault');
  const [vaultCreated, setVaultCreated] = useState(false);
  const [container, setContainer] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [progress, setProgress] = useState<ProgressInfo>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [decrypted, setDecrypted] = useState<DecryptedBundle | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const vaultFileInput = useRef<HTMLInputElement>(null);
  const vaultFolderInput = useRef<HTMLInputElement>(null);

  const { needRefresh, updateServiceWorker } = useRegisterSW();
  const totalBytes = useMemo(() => sources.reduce((n, s) => n + s.file.size, 0), [sources]);
  const vaultTotalBytes = useMemo(() => vaultSources.reduce((n, s) => n + s.file.size, 0), [vaultSources]);

  function reset(next: Mode) {
    setMode(next);
    setSources([]);
    setContainer(null);
    setPassword('');
    setConfirm('');
    setProgress(undefined);
    setError('');
    setNotice('');
    setDecrypted(null);
    setRestoring(false);
    setShowFiles(false);
  }

  function resetVault() {
    setVaultSources([]);
    setVaultName('My Vault');
    setVaultCreated(false);
    setPassword('');
    setConfirm('');
    setProgress(undefined);
    setError('');
    setNotice('');
  }

  function addVaultFiles(list: FileList) {
    setVaultSources((current) => mergeSources(current, fromFileList(list)));
    setError('');
    setNotice('');
  }

  async function encryptSelection(items: SourceFile[], suggestedName: string) {
    if (!items.length) throw new Error('Choose at least one file or a folder.');
    if (password.length < 12) throw new Error('Use a passphrase of at least 12 characters. Longer is strongly recommended.');
    if (password !== confirm) throw new Error('Passphrases do not match.');
    const total = items.reduce((n, s) => n + s.file.size, 0);
    const { sink, mode: sinkMode } = await createDownloadSink(suggestedName);
    if (sinkMode === 'memory' && total > 1024 * 1024 * 1024) {
      throw new Error('This browser cannot stream directly to disk. For files over 1 GB, use a browser with the File System Access API.');
    }
    await encryptToSink(items, password, sink, setProgress);
  }

  async function encrypt() {
    setError(''); setNotice('');
    setBusy(true);
    try {
      await encryptSelection(sources, randomContainerName());
      setNotice('Encrypted successfully. The original names and metadata are stored only inside the encrypted container.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Encryption failed.');
    } finally {
      setBusy(false);
    }
  }

  function createVault() {
    setError(''); setNotice('');
    const name = vaultName.trim();
    if (!name) return setError('Give the vault a name first.');
    setVaultName(name);
    setVaultCreated(true);
    setVaultSources([]);
    setPassword('');
    setConfirm('');
    setNotice(`“${name}” is ready. Add files and folders, then export the vault when you're finished.`);
  }

  async function exportVault() {
    setError(''); setNotice('');
    if (!vaultCreated) return setError('Create the vault first.');
    if (!vaultSources.length) return setError('Add at least one file or folder to the vault.');
    setBusy(true);
    try {
      const safeName = vaultName.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'vault';
      await encryptSelection(vaultSources, `${safeName}.zkv`);
      setNotice(`“${vaultName.trim()}” was exported as an encrypted .zkv container.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vault export failed.');
    } finally {
      setBusy(false);
    }
  }

  async function decrypt() {
    setError(''); setNotice(''); setDecrypted(null);
    if (!container) return setError('Choose a .zkv container.');
    if (!password) return setError('Enter the passphrase.');
    setBusy(true);
    try {
      const result = await decryptFromFile(container, password, setProgress);
      setDecrypted(result);
      setNotice('Container authenticated and decrypted locally. Nothing was uploaded.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decryption failed.');
    } finally {
      setBusy(false);
    }
  }

  async function restoreFolder() {
    if (!decrypted) return;
    setError(''); setNotice(''); setRestoring(true);
    try {
      await restoreBundleToFolder(decrypted, password, setProgress);
      setNotice('Folder restored directly to the location you selected.');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Folder restore failed.');
    } finally {
      setRestoring(false);
    }
  }

  async function downloadFolderZip() {
    if (!decrypted) return;
    setError(''); setNotice(''); setRestoring(true);
    try {
      await downloadZip(decrypted, password, zipNameForBundle(decrypted), setProgress);
      setNotice('ZIP created locally. No decrypted data was uploaded.');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'ZIP creation failed.');
    } finally {
      setRestoring(false);
    }
  }

  async function downloadOne(index: number) {
    if (!decrypted) return;
    setError(''); setNotice(''); setRestoring(true);
    try {
      await downloadDecryptedFile(decrypted, password, index, setProgress);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'File download failed.');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="eyebrow"><span className="status-dot" /> LOCAL-ONLY CRYPTO</div>
        <h1>Cander ZK Vault</h1>
        <p>Encrypt files and folders in your browser. No accounts. No uploads. No server-side keys.</p>
        <div className="privacy-strip">
          <span>✓ Client-side encryption</span><span>✓ Encrypted filenames + metadata</span><span>✓ Offline-capable PWA</span>
        </div>
      </header>

      {needRefresh[0] && (
        <div className="update-banner">A new verified app build is available. <button onClick={() => updateServiceWorker(true)}>Reload into it</button></div>
      )}

      <section className="card">
        <div className="tabs tabs-three">
          <button className={mode === 'encrypt' ? 'active' : ''} onClick={() => reset('encrypt')}>Encrypt</button>
          <button className={mode === 'vault' ? 'active' : ''} onClick={() => reset('vault')}>Create vault</button>
          <button className={mode === 'decrypt' ? 'active' : ''} onClick={() => reset('decrypt')}>Decrypt</button>
        </div>

        {mode === 'encrypt' ? (
          <div className="panel">
            <h2>Create an encrypted container</h2>
            <p className="muted">Your selected data is read locally and written into one authenticated <code>.zkv</code> file.</p>
            <div className="pick-grid">
              <button className="picker" onClick={() => fileInput.current?.click()}><strong>Choose files</strong><span>Select one or many files</span></button>
              <button className="picker" onClick={() => folderInput.current?.click()}><strong>Choose folder</strong><span>Preserve its relative structure</span></button>
            </div>
            <input ref={fileInput} hidden type="file" multiple onChange={(e) => e.target.files && setSources(fromFileList(e.target.files))} />
            <input ref={folderInput} hidden type="file" multiple {...({ webkitdirectory: '', directory: '' } as object)} onChange={(e) => e.target.files && setSources(fromFileList(e.target.files))} />

            {sources.length > 0 && (
              <div className="selection"><div><strong>{sources.length} file{sources.length === 1 ? '' : 's'}</strong><span>{formatBytes(totalBytes)}</span></div><span className="ellipsis">{sources[0].path}{sources.length > 1 ? ` + ${sources.length - 1} more` : ''}</span></div>
            )}

            <label>Passphrase<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Use a long, unique passphrase" /></label>
            <label>Confirm passphrase<input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat passphrase" /></label>
            <div className="warning">There is no recovery mechanism. Losing this passphrase means losing access to the encrypted data.</div>
            <button className="primary" disabled={busy} onClick={encrypt}>{busy ? 'Working…' : 'Encrypt locally'}</button>
          </div>
        ) : mode === 'vault' ? (
          <div className="panel">
            <h2>Create a vault first</h2>
            <p className="muted">Create an empty working vault, then add files and folders from different locations before exporting one encrypted <code>.zkv</code> container.</p>

            {!vaultCreated ? (
              <>
                <label>Vault name<input type="text" autoComplete="off" value={vaultName} onChange={(e) => setVaultName(e.target.value)} placeholder="My Vault" /></label>
                <button className="primary" disabled={busy} onClick={createVault}>Create empty vault</button>
              </>
            ) : (
              <>
                <div className="vault-header">
                  <div><span className="vault-label">Working vault</span><strong>{vaultName}</strong></div>
                  <button className="secondary-action compact" disabled={busy} onClick={resetVault}>New vault</button>
                </div>

                <div className="pick-grid">
                  <button className="picker" onClick={() => vaultFileInput.current?.click()}><strong>Add files</strong><span>Add one or many files</span></button>
                  <button className="picker" onClick={() => vaultFolderInput.current?.click()}><strong>Add folder</strong><span>Add a folder and preserve its structure</span></button>
                </div>
                <input ref={vaultFileInput} hidden type="file" multiple onChange={(e) => e.target.files && addVaultFiles(e.target.files)} />
                <input ref={vaultFolderInput} hidden type="file" multiple {...({ webkitdirectory: '', directory: '' } as object)} onChange={(e) => e.target.files && addVaultFiles(e.target.files)} />

                <div className="vault-summary">
                  <div><strong>{vaultSources.length} file{vaultSources.length === 1 ? '' : 's'}</strong><span>{formatBytes(vaultTotalBytes)}</span></div>
                  {vaultSources.length > 0 ? (
                    <div className="vault-file-list">
                      {vaultSources.map((source, index) => (
                        <div className="vault-file" key={`${source.path}-${source.file.size}-${source.file.lastModified}-${index}`}>
                          <span className="ellipsis">{source.path}</span>
                          <button type="button" aria-label={`Remove ${source.path}`} disabled={busy} onClick={() => setVaultSources((items) => items.filter((_, i) => i !== index))}>Remove</button>
                        </div>
                      ))}
                    </div>
                  ) : <p className="muted">Your vault is empty. You can add files from multiple locations without moving them into a temporary folder first.</p>}
                </div>

                <label>Passphrase<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Use a long, unique passphrase" /></label>
                <label>Confirm passphrase<input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat passphrase" /></label>
                <div className="warning">The working vault exists only in this browser session until you export it. There is no recovery mechanism for the passphrase.</div>
                <button className="primary" disabled={busy || !vaultSources.length} onClick={exportVault}>{busy ? 'Working…' : 'Export encrypted vault'}</button>
              </>
            )}
          </div>
        ) : (
          <div className="panel">
            <h2>Open an encrypted container</h2>
            <p className="muted">Authentication happens before restored content is offered for download.</p>
            <label className="file-drop">Encrypted container<input type="file" accept=".zkv,application/octet-stream" onChange={(e) => setContainer(e.target.files?.[0] ?? null)} /></label>
            {container && <div className="selection"><div><strong>{container.name}</strong><span>{formatBytes(container.size)}</span></div></div>}
            <label>Passphrase<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter the original passphrase" /></label>
            <button className="primary" disabled={busy} onClick={decrypt}>{busy ? 'Working…' : 'Decrypt locally'}</button>

            {decrypted && (
              <div className="results">
                <div className="restore-summary">
                  <div>
                    <h3>Decrypted contents</h3>
                    <strong>{bundleDisplayName(decrypted)}</strong>
                    <span>{decrypted.manifest.entries.length} file{decrypted.manifest.entries.length === 1 ? '' : 's'} · {formatBytes(decrypted.manifest.entries.reduce((sum, item) => sum + item.size, 0))}</span>
                  </div>
                  <div className="restore-actions">
                    {canRestoreToFolder() && (
                      <button className="secondary-action" disabled={restoring} onClick={restoreFolder}>{restoring ? 'Restoring…' : 'Restore to folder'}</button>
                    )}
                    <button className="secondary-action" disabled={restoring} onClick={downloadFolderZip}>Download as ZIP</button>
                  </div>
                  {!canRestoreToFolder() && <p className="muted compatibility-note">Direct folder restore is not supported by this browser. Download as ZIP preserves the folder structure.</p>}
                </div>
                <button className="file-list-toggle" onClick={() => setShowFiles((value) => !value)}>{showFiles ? 'Hide files' : 'Show files'}</button>
                {showFiles && <div className="file-list">{decrypted.manifest.entries.map((meta, index) => <div className="result" key={meta.path}><span className="ellipsis">{meta.path}</span><button disabled={restoring} onClick={() => downloadOne(index)}>{formatBytes(meta.size)} · Download</button></div>)}</div>}
              </div>
            )}
          </div>
        )}

        <Progress info={progress} />
        {error && <div className="message error">{error}</div>}
        {notice && <div className="message success">{notice}</div>}
      </section>

      <footer><strong>Network not required after installation.</strong><span>Format v1 · Argon2id · XChaCha20-Poly1305 secretstream</span></footer>
    </main>
  );
}
