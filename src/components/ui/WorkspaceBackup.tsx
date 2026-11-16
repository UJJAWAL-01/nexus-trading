'use client'

// Backup / restore everything NEXUS stores in this browser (watchlist,
// portfolio, layouts, chart drawings, preferences) as one JSON file.
// Runs entirely client-side; the file never touches a server.

import { useRef, useState } from 'react'
import { downloadBackup, parseBackup, restoreBackup } from '@/lib/export'

const linkStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--text-2)', fontFamily: 'var(--font-data)', fontSize: 13,
  textDecoration: 'underline', textUnderlineOffset: 3,
}

export default function WorkspaceBackup() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null)

  const onBackup = () => {
    try {
      const n = downloadBackup()
      setNote({ text: `Backup downloaded (${n} items).`, ok: true })
    } catch {
      setNote({ text: 'Could not create a backup in this browser.', ok: false })
    }
  }

  const onRestore = async (file: File) => {
    try {
      const backup = parseBackup(await file.text())
      const count  = Object.keys(backup.keys).length
      const when   = backup.exportedAt ? ` from ${backup.exportedAt.slice(0, 10)}` : ''
      if (!window.confirm(`Restore ${count} saved items${when}? This replaces the matching settings in this browser, then reloads the page.`)) return
      restoreBackup(backup)
      window.location.reload()
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : 'Restore failed.', ok: false })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 14, fontSize: 13, fontFamily: 'var(--font-data)', color: 'var(--text-muted)' }}>
      <span>YOUR DATA STAYS IN THIS BROWSER</span>
      <button type="button" style={linkStyle} onClick={onBackup} title="Download watchlist, portfolio, layouts and drawings as one file">
        Back up workspace
      </button>
      <button type="button" style={linkStyle} onClick={() => fileRef.current?.click()} title="Load a workspace backup file">
        Restore workspace
      </button>
      <input
        ref={fileRef} type="file" accept=".json,application/json" hidden aria-label="Restore workspace backup"
        onChange={e => { const f = e.target.files?.[0]; if (f) void onRestore(f) }}
      />
      {note && <span role="status" style={{ color: note.ok ? 'var(--positive)' : 'var(--negative)' }}>{note.text}</span>}
    </div>
  )
}
