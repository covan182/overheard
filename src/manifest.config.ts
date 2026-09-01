import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Overheard',
  version: '0.1.2',
  description: 'Learn languages by watching YouTube with dual subtitles.',
  icons: {
    16: 'src/assets/icons/icon16.png',
    32: 'src/assets/icons/icon32.png',
    48: 'src/assets/icons/icon48.png',
    128: 'src/assets/icons/icon128.png',
  },
  action: {
    default_popup: 'index.html',
    default_icon: {
      16: 'src/assets/icons/icon16.png',
      32: 'src/assets/icons/icon32.png',
      48: 'src/assets/icons/icon48.png',
      128: 'src/assets/icons/icon128.png',
    },
  },
  permissions: ['storage'],
  host_permissions: [
    'https://www.youtube.com/*',
    'https://*.youtube.com/*',
    'https://translate.googleapis.com/*',
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_security_policy: {
    extension_pages: "script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com;",
  },
  content_scripts: [
    {
      js: ['src/content/index.tsx'],
      matches: ['https://www.youtube.com/*'],
      run_at: 'document_start'
    },
    {
      js: ['src/content/hook.ts'],
      matches: ['https://www.youtube.com/*'],
      world: 'MAIN',
      run_at: 'document_start'
    }
  ],
});