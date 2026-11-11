// src/lib/export.ts
// Client-side data export and workspace backup. Nothing here talks to a
// server: files are generated in the browser and data never leaves the device.

export type Cell = string | number | boolean | null | undefined

/**
 * Escape one CSV cell. Also neutralises spreadsheet formula injection: a text
 * cell starting with = + - @ is prefixed with an apostrophe so Excel/Sheets
 * treat it as text instead of executing it. Numbers are left untouched.
 */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  let s = value
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** Minimal RFC-4180 parser: quoted fields, escaped quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c.trim() !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some(c => c.trim() !== '')) rows.push(row)
  return rows
}

export function downloadFile(filename: string, content: string, mime: string): void {
  if (typeof window === 'undefined') return
  // BOM so Excel opens UTF-8 CSV (₹, €) correctly.
  const data = mime.startsWith('text/csv') ? '﻿' + content : content
  const url  = URL.createObjectURL(new Blob([data], { type: mime }))
  const a    = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(name: string, headers: string[], rows: Cell[][]): void {
  downloadFile(`${name}-${stamp()}.csv`, toCsv(headers, rows), 'text/csv;charset=utf-8')
}

export const stamp = () => new Date().toISOString().slice(0, 10)

// ── Workspace backup / restore ───────────────────────────────────────────────
// Everything NEXUS remembers (watchlist, portfolio, layouts, chart drawings,
// preferences) lives in localStorage under the "nexus" prefix. A backup is a
// single JSON file of those keys, so a workspace can be moved between browsers
// and devices without an account or a server.

const PREFIX        = 'nexus'
const BACKUP_FORMAT = 'nexus-workspace-backup'
const MAX_BACKUP_BYTES = 5 * 1024 * 1024
const MAX_KEYS         = 2000

export interface WorkspaceBackup {
  format:     typeof BACKUP_FORMAT
  version:    1
  exportedAt: string
  keys:       Record<string, string>
}

export function createBackup(): WorkspaceBackup {
  const keys: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith(PREFIX)) continue
    const v = localStorage.getItem(k)
    if (v !== null) keys[k] = v
  }
  return { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), keys }
}

export function downloadBackup(): number {
  const backup = createBackup()
  downloadFile(`nexus-workspace-${stamp()}.json`, JSON.stringify(backup, null, 2), 'application/json')
  return Object.keys(backup.keys).length
}

/**
 * Validate a backup file's text. Returns the parsed backup or throws an Error
 * with a user-facing message. Only "nexus"-prefixed string values are accepted,
 * so a crafted file cannot write arbitrary storage keys.
 */
export function parseBackup(text: string): WorkspaceBackup {
  if (text.length > MAX_BACKUP_BYTES) throw new Error('Backup file is too large.')
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('This file is not valid JSON.') }
  const b = raw as Partial<WorkspaceBackup> | null
  if (!b || b.format !== BACKUP_FORMAT || b.version !== 1 || typeof b.keys !== 'object' || b.keys === null) {
    throw new Error('This is not a NEXUS workspace backup.')
  }
  const entries = Object.entries(b.keys)
  if (entries.length > MAX_KEYS) throw new Error('Backup contains too many entries.')
  const keys: Record<string, string> = {}
  for (const [k, v] of entries) {
    if (!k.startsWith(PREFIX) || typeof v !== 'string') continue
    keys[k] = v
  }
  if (!Object.keys(keys).length) throw new Error('Backup contains no NEXUS data.')
  return { format: BACKUP_FORMAT, version: 1, exportedAt: String(b.exportedAt ?? ''), keys }
}

/** Write a validated backup into localStorage. Returns the number of keys restored. */
export function restoreBackup(backup: WorkspaceBackup): number {
  let n = 0
  for (const [k, v] of Object.entries(backup.keys)) {
    try { localStorage.setItem(k, v); n++ } catch { /* quota: skip */ }
  }
  return n
}
