import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const contentType = 'image/png'

// 192×192 — standard Android/PWA home-screen icon
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%',
          background: '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
          borderRadius: 32,
        }}
      >
        <div style={{
          color: '#fff',
          fontSize: 144,
          fontWeight: 900,
          fontFamily: 'sans-serif',
          letterSpacing: '-0.08em',
          lineHeight: 1,
        }}>N</div>
        <div style={{
          position: 'absolute',
          bottom: 22, right: 22,
          width: 34, height: 34,
          background: '#f0a500',
          borderRadius: 7,
        }} />
      </div>
    ),
    { width: 192, height: 192 },
  )
}
