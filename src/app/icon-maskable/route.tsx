import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const contentType = 'image/png'

// 512×512 maskable variant — content lives inside the inner 70% "safe zone"
// so that Android/iOS shape-mask cropping (circle, squircle, rounded) doesn't
// clip the logo. Background bleeds to the edge.
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%',
          background: '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div style={{
          width: '70%', height: '70%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          <div style={{
            color: '#fff',
            fontSize: 280,
            fontWeight: 900,
            fontFamily: 'sans-serif',
            letterSpacing: '-0.08em',
            lineHeight: 1,
          }}>N</div>
          <div style={{
            position: 'absolute',
            bottom: '4%', right: '4%',
            width: '24%', height: '24%',
            background: '#f0a500',
            borderRadius: 18,
          }} />
        </div>
      </div>
    ),
    { width: 512, height: 512 },
  )
}
