import { defineConfig } from 'vitepress';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const production = process.env.NODE_ENV === 'production';
const base = process.env.VITEPRESS_BASE || (production ? '/FaceR.js/' : '/docs/');
const here = path.dirname(fileURLToPath(import.meta.url));

function firstExisting(label, candidates) {
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error(`${label} not found. Run "npm install" and "npm run build:lib" in the repository root first.`);
  return found;
}

// One copy of each library, so `instanceof Vec3` and friends hold across FaceR, RoostR and the demo.
const alias = {
  '@1pizzateam/facer': firstExisting('FaceR build', [
    path.resolve(here, '../../dist/facer.js'),    // Docker: dist/ mounted next to docs/
    path.resolve(here, '../../../dist/facer.js'), // repository checkout
  ]),
  '@1pizzateam/spock': firstExisting('Spock', [
    path.resolve(here, '../../../node_modules/@1pizzateam/spock/dist/spock.js'),
    path.resolve(here, '../../node_modules/@1pizzateam/spock/dist/spock.js'),
  ]),
  '@1pizzateam/roostr': firstExisting('RoostR', [
    path.resolve(here, '../../../node_modules/@1pizzateam/roostr/dist/roostr.js'),
    path.resolve(here, '../../node_modules/@1pizzateam/roostr/dist/roostr.js'),
  ]),
};

export default defineConfig({
  title: 'FaceR.js',
  description: 'Real-time anatomical facial animation: FACS rig, layered emotions and Perlin-driven behaviour for the web.',
  base,
  cleanUrls: true,
  vite: {
    server: { host: '0.0.0.0', port: 5184, allowedHosts: true },
    resolve: { alias },
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['meta', { name: 'theme-color', content: '#e8590c' }],
  ],
  themeConfig: {
    siteTitle: 'FaceR.js',
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Overview', link: '/guide/overview' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Custom heads', link: '/guide/custom-heads' },
        ],
      },
      {
        text: 'API',
        items: [
          { text: 'Overview', link: '/api/' },
          { text: 'FaceR', link: '/api/facer' },
          { text: 'Cartridge', link: '/api/cartridge' },
          { text: 'Behaviour', link: '/api/behaviour' },
          { text: 'Rendering', link: '/api/rendering' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/1pizzateam/FaceR.js' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@1pizzateam/facer' },
    ],
    search: { provider: 'local' },
    footer: {
      message: 'Released under the MIT License. Head geometry credits in NOTICE.md.',
      copyright: 'Copyright © 2026-present 1 Pizza Team',
    },
  },
});
