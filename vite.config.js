import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'prompt',
            includeAssets: [],
            manifest: {
                name: 'ZK Vault',
                short_name: 'ZK Vault',
                description: 'Offline-first zero-knowledge file and folder encryption.',
                theme_color: '#111318',
                background_color: '#111318',
                display: 'standalone',
                start_url: '/',
                scope: '/'
            },
            workbox: {
                navigateFallback: '/index.html',
                cleanupOutdatedCaches: true,
                clientsClaim: false,
                skipWaiting: false
            }
        })
    ]
});
