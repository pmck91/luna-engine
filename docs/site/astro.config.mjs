import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://pmck91.github.io',
  base: '/luna-engine',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Luna Engine',
      description:
        'Create parser-driven text adventures with Luna’s visual block editor and shared Rust game engine.',
      logo: { src: '../../assets/logo-transparent.png', alt: 'Luna Engine' },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/pmck91/luna-engine',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/pmck91/luna-engine/edit/main/docs/site/',
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Getting started',
          items: [{ autogenerate: { directory: 'getting-started' } }],
        },
        {
          label: 'Tutorials',
          items: [{ autogenerate: { directory: 'tutorials' } }],
        },
        {
          label: 'Editor guide',
          items: [{ autogenerate: { directory: 'editor' } }],
        },
        {
          label: 'Game logic',
          items: [{ autogenerate: { directory: 'logic' } }],
        },
        {
          label: 'Playing and sharing',
          items: [{ autogenerate: { directory: 'playing' } }],
        },
        {
          label: 'Reference',
          items: [{ autogenerate: { directory: 'reference' } }],
        },
        {
          label: 'Developer documentation',
          collapsed: true,
          items: [{ autogenerate: { directory: 'developer' } }],
        },
      ],
    }),
  ],
});
