import { ImageResponse } from 'next/og'

// 180×180 — Apple touch icon (iOS Home Screen)
// iOS auto-rounds corners, so we use a fully rounded bg.
export const size        = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%',
          background: '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}
      >
        <div style={{
          color: '#fff',
          fontSize: 136,
          fontWeight: 900,
          fontFamily: 'sans-serif',
          letterSpacing: '-0.08em',
          lineHeight: 1,
        }}>N</div>
        <div style={{
          position: 'absolute',
          bottom: 20, right: 20,
          width: 32, height: 32,
          background: '#f0a500',
          borderRadius: 7,
        }} />
      </div>
    ),
    size,
  )
}
