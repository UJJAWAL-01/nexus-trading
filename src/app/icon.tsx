import { ImageResponse } from 'next/og'

// 32×32 favicon — used in browser tabs
export const size        = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
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
          fontSize: 26,
          fontWeight: 900,
          fontFamily: 'sans-serif',
          letterSpacing: '-0.05em',
          lineHeight: 1,
        }}>N</div>
        <div style={{
          position: 'absolute',
          bottom: 3, right: 3,
          width: 6, height: 6,
          background: '#f0a500',
          borderRadius: 1,
        }} />
      </div>
    ),
    size,
  )
}
