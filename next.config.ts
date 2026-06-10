import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',   // required for Azure Static Web Apps SSR
  reactCompiler: true,
  poweredByHeader: false,

  // Allow the dev server's HMR websocket to accept requests from these origins.
  // Next.js 16 blocks LAN/non-localhost dev origins by default for safety.
  // This affects DEV ONLY — production builds ignore it.
  //
  // Matcher syntax (per Next.js source, csrf-protection.js):
  //   • exact host:  '192.168.56.1'
  //   • '*' matches exactly ONE dot-segment ('192.168.*.*' matches '192.168.x.y')
  //   • '**' matches REMAINING segments ('192.168.**' matches all subnets)
  //   • CIDR is NOT supported — '/16' would be treated as a literal string
  //
  // Covers: localhost, all 192.168.x.x (home routers, VirtualBox host-only,
  // WSL bridged), 10.x.x.x (WSL2 default, corporate VPN), 172.16.x.x-172.31.x.x
  // (Docker default range — added narrowly to avoid over-allow).
  allowedDevOrigins: [
    'localhost',
    '*.localhost',
    '127.0.0.1',
    '192.168.**',
    '10.**',
    '172.16.**',
    '172.17.**',
    '172.18.**',
    '172.19.**',
    '172.20.**',
    '172.21.**',
    '172.22.**',
    '172.23.**',
    '172.24.**',
    '172.25.**',
    '172.26.**',
    '172.27.**',
    '172.28.**',
    '172.29.**',
    '172.30.**',
    '172.31.**',
  ],

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options',    value: 'nosniff' },
          { key: 'X-Frame-Options',           value: 'DENY' },
          { key: 'X-XSS-Protection',          value: '1; mode=block' },
          { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
          {
            key:   'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            // Allow YouTube iframes for LiveFinanceVideoPanel; allow inline styles
            // for Tailwind; allow data: URIs for charts; blob: for TradingView workers.
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",  // Next.js requires unsafe-eval in dev; restrict further if needed
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https:",
              "media-src 'self' blob:",
              "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
              "connect-src 'self' https: wss:",
              "worker-src 'self' blob:",
            ].join('; '),
          },
        ],
      },
    ]
  },
};

export default nextConfig;
