import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'TelaCast — Espelhamento ao Vivo',
    short_name: 'TelaCast',
    description: 'Espelhamento de tela e jogos Android ao vivo exclusivo pelo aplicativo TelaCast.',
    start_url: '/assistir?mode=app',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#090d16',
    theme_color: '#1d4ed8',
    icons: [
      {
        src: '/pwa-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
