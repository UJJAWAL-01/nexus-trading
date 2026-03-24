import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base:   '#090c10',
          panel:  '#0d1117',
          deep:   '#111820',
        },
        border: {
          DEFAULT: '#1e2d3d',
          bright:  '#243344',
        },
        amber: {
          DEFAULT: '#f0a500',
          bright:  '#ffcc55',
        },
        teal:   '#00e5c0',
        danger: '#ff4560',
        info:   '#1e90ff',
        positive: '#00c97a',
        negative: '#ff4560',
        text: {
          primary:   '#c8d8e8',
          secondary: '#7a9ab0',
          muted:     '#4a6070',
        }
      },
      fontFamily: {
        mono:    ['JetBrains Mono', 'monospace'],
        display: ['Syne', 'sans-serif'],
      },
      animation: {
        'price-flash-up':   'priceUp 0.6s ease-out',
        'price-flash-down': 'priceDown 0.6s ease-out',
        'slide-in-news':    'slideInNews 0.3s ease-out',
        'pulse-glow':       'pulseGlow 2s ease-in-out infinite',
      },
      keyframes: {
        priceUp: {
          '0%':   { backgroundColor: 'rgba(0,201,122,0.3)' },
          '100%': { backgroundColor: 'transparent' },
        },
        priceDown: {
          '0%':   { backgroundColor: 'rgba(255,69,96,0.3)' },
          '100%': { backgroundColor: 'transparent' },
        },
        slideInNews: {
          '0%':   { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGlow: {
          '0%,100%': { boxShadow: '0 0 6px rgba(240,165,0,0.3)' },
          '50%':     { boxShadow: '0 0 18px rgba(240,165,0,0.6)' },
        }
      }
    },
  },
  plugins: [],
}
export default config