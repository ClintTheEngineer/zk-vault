/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'libsodium-wrappers-sumo';

interface Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
}
