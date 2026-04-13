// 'use client'

// import { useEffect, useRef, useState } from 'react'

// type MarketState = 'closed' | 'bull' | 'bear' | 'neutral'

// interface CharState {
//   x: number
//   vx: number
//   ax: number
//   facing: number
//   targetFacing: number
//   action: 'walk' | 'charge' | 'retreat' | 'idle'
//   bob: number
//   frame: number
// }

// const STRIP_H = 50
// const FRAME_W = 64
// const FRAME_H = 64
// const TOTAL_FRAMES = 6

// const MAX_SPEED = 3.2
// const ACC = 0.18
// const FRICTION = 0.92
// const COLLISION_DIST = 70

// // 🎮 SPRITE RENDERER (CORE FIX)
// function Sprite({
//   src,
//   frame,
//   facing,
// }: {
//   src: string
//   frame: number
//   facing: number
// }) {
//   return (
//     <div
//       style={{
//         width: FRAME_W,
//         height: FRAME_H,
//         overflow: 'hidden',
//         transform: `scaleX(${facing})`,
//         imageRendering: 'pixelated',
//       }}
//     >
//       <img
//         src={src}
//         alt="sprite"
//         style={{
//           position: 'relative',
//           left: `-${Math.floor(frame) * FRAME_W}px`,
//           width: FRAME_W * TOTAL_FRAMES,
//           height: FRAME_H,
//         }}
//       />
//     </div>
//   )
// }

// export default function BullBearMascot() {
//   const ref = useRef<HTMLDivElement>(null)

//   const [w, setW] = useState(300)
//   const [state, setState] = useState<MarketState>('neutral')
//   const [shake, setShake] = useState(0)

//   const [bull, setBull] = useState<CharState>({
//     x: 100, vx: 0, ax: 0,
//     facing: 1, targetFacing: 1,
//     action: 'walk', bob: 0, frame: 0
//   })

//   const [bear, setBear] = useState<CharState>({
//     x: 500, vx: 0, ax: 0,
//     facing: -1, targetFacing: -1,
//     action: 'walk', bob: 0, frame: 0
//   })

//   // 📏 Resize
//   useEffect(() => {
//     const ro = new ResizeObserver(e => setW(e[0].contentRect.width))
//     if (ref.current) ro.observe(ref.current)
//     return () => ro.disconnect()
//   }, [])

//   // 🎲 Market state simulation
//   useEffect(() => {
//     const id = setInterval(() => {
//       const r = Math.random()
//       if (r > 0.66) setState('bull')
//       else if (r < 0.33) setState('bear')
//       else setState('neutral')
//     }, 5000)
//     return () => clearInterval(id)
//   }, [])

//   // 🎮 Game loop
//   useEffect(() => {
//     let raf: number

//     const step = () => {
//       const max = w - FRAME_W

//       const update = (char: CharState, type: 'bull' | 'bear') => {
//         let { x, vx, ax, facing, targetFacing, action, bob, frame } = char

//         if (state === type) {
//           ax = type === 'bull' ? ACC : -ACC
//           action = 'charge'
//           targetFacing = type === 'bull' ? 1 : -1
//         } else if (state !== 'neutral') {
//           ax = type === 'bull' ? -ACC : ACC
//           action = 'retreat'
//           targetFacing = type === 'bull' ? -1 : 1
//         } else {
//           ax = 0
//           action = 'walk'
//         }

//         vx += ax
//         vx *= FRICTION
//         vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, vx))

//         x += vx
//         facing += (targetFacing - facing) * 0.15

//         if (x < 0 || x > max) vx *= -0.5

//         bob = Math.sin(Date.now() * 0.02) * 2

//         // 🔥 FRAME ANIMATION (IMPORTANT)
//         frame = (frame + Math.abs(vx) * 0.3 + 0.05) % TOTAL_FRAMES

//         return {
//           x: Math.max(0, Math.min(max, x)),
//           vx, ax, facing, targetFacing, action, bob, frame
//         }
//       }

//       setBull(prev => update(prev, 'bull'))
//       setBear(prev => update(prev, 'bear'))

//       // 💥 Collision
//       if (Math.abs(bull.x - bear.x) < COLLISION_DIST) {
//         setBull(b => ({ ...b, vx: -b.vx * 0.7 }))
//         setBear(b => ({ ...b, vx: -b.vx * 0.7 }))
//         setShake(6)
//       }

//       if (shake > 0) setShake(s => s - 1)

//       raf = requestAnimationFrame(step)
//     }

//     raf = requestAnimationFrame(step)
//     return () => cancelAnimationFrame(raf)
//   }, [state, w, bull.x, bear.x, shake])

//   return (
//     <div
//       ref={ref}
//       style={{
//         height: STRIP_H,
//         position: 'relative',
//         overflow: 'hidden',
//         background: '#020617',
//         transform: `translateX(${shake % 2 === 0 ? -1 : 1}px)`,
//         borderBottom: '1px solid rgba(148,163,184,0.2)'
//       }}
//     >
//       {/* ground line */}
//       <div
//         style={{
//           position: 'absolute',
//           bottom: 10,
//           left: 0,
//           right: 0,
//           height: 1,
//           background: 'rgba(148,163,184,0.2)'
//         }}
//       />

//       {/* 🐂 Bull */}
//       <div
//         style={{
//           position: 'absolute',
//           left: bull.x,
//           bottom: 5 + bull.bob,
//         }}
//       >
//         <Sprite
//           src="/pets/bull_walk.png"
//           frame={bull.frame}
//           facing={bull.facing}
//         />
//       </div>

//       {/* 🐻 Bear */}
//       <div
//         style={{
//           position: 'absolute',
//           left: bear.x,
//           bottom: 5 + bear.bob,
//         }}
//       >
//         <Sprite
//           src="/pets/bear_walk.png"
//           frame={bear.frame}
//           facing={bear.facing}
//         />
//       </div>
//     </div>
//   )
// }