import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const contentType = 'image/png'

// 512×512 — large PWA icon (used by Chrome install prompt, Android home-screen, splash)
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%',
          background: '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
          borderRadius: 96,
        }}
      >
        <div style={{
          color: '#fff',
          fontSize: 384,
          fontWeight: 900,
          fontFamily: 'sans-serif',
          letterSpacing: '-0.08em',
          lineHeight: 1,
        }}>N</div>
        <div style={{
          position: 'absolute',
          bottom: 60, right: 60,
          width: 90, height: 90,
          background: '#f0a500',
          borderRadius: 20,
        }} />
      </div>
    ),
    { width: 512, height: 512 },
  )
}
