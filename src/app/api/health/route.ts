import { NextResponse } from 'next/server'

// Liveness probe for Docker / load balancers. Deliberately reports nothing
// about configuration, versions or which provider keys are present.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
