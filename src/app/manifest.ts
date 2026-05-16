import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:               'NEXUS Trading Intelligence',
    short_name:         'NEXUS',
    description:        'Bloomberg-style real-time trading intelligence for US and Indian markets — chart, smart money, options, news, all in one terminal.',
    start_url:          '/',
    scope:              '/',
    display:            'standalone',
    display_override:   ['window-controls-overlay', 'standalone'],
    orientation:        'any',
    background_color:   '#000000',
    theme_color:        '#000000',
    categories:         ['finance', 'business', 'productivity', 'utilities'],
    lang:               'en',
    dir:                'ltr',
    prefer_related_applications: false,
    icons: [
      { src: '/icon',           sizes: 'any',     type: 'image/png', purpose: 'any'      },
      { src: '/icon-192',       sizes: '192x192', type: 'image/png', purpose: 'any'      },
      { src: '/icon-512',       sizes: '512x512', type: 'image/png', purpose: 'any'      },
      { src: '/icon-maskable',  sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/apple-icon',     sizes: '180x180', type: 'image/png', purpose: 'any'      },
    ],
    shortcuts: [
      { name: 'Open Pro Layout',    short_name: 'Pro',     url: '/?layout=tabs',    description: 'Tabbed view with chart hero' },
      { name: 'Open Classic Grid',  short_name: 'Classic', url: '/?layout=classic', description: 'Draggable 19-panel grid'     },
      { name: 'Forex / Crypto',     short_name: 'FX',      url: '/trading',         description: 'Forex & crypto trading suite' },
    ],
  }
}
