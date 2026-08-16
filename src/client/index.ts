/**
 * @dsh-external/dsh-cheatengine — client floating status panel.
 * Registered on the `shell.overlay` slot. Polls `/ce-status/api` every 2s
 * and renders a minimal human-readable summary. Non-blocking.
 *
 * The panel is optional: it can be closed with × and reopened via a small
 * floating "🧊 CE" button. The choice is persisted in localStorage.
 */
import { createElement, useEffect, useState } from 'react'
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'

type ClientContext = {
  slots: SlotsService
}

export const inject = ['slots']

interface StatusData {
  phase?: string
  call_count?: number
  scan_count?: number
  locked_addresses?: string[]
  summary?: string
  recent_events?: Array<{ text: string; ts?: number }>
}

const STORAGE_KEY = 'dsh-ce-panel-hidden'

function readHidden(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeHidden(hidden: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, hidden ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function row(label: string, value: string | number | undefined) {
  return createElement(
    'div',
    { style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
    createElement('span', null, label),
    createElement('b', null, String(value ?? '-')),
  )
}

function Panel(): any {
  const [data, setData] = useState<StatusData>({})
  const [hidden, setHidden] = useState<boolean>(readHidden)

  useEffect(() => {
    if (hidden) return
    let alive = true
    function tick() {
      fetch('/ce-status/api')
        .then((r) => r.json())
        .then((d) => { if (alive) setData(d) })
        .catch(() => {})
    }
    tick()
    const timer = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [hidden])

  const reopenStyle = {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 99999,
    border: '1px solid var(--dsw-alias-border-l2, #333)',
    background: 'var(--dsw-alias-bg-layer-3, #1c1c1c)',
    color: 'var(--dsw-alias-label-primary, #eee)',
    borderRadius: 12,
    padding: '8px 12px',
    font: '12px/1.5 system-ui',
    cursor: 'pointer',
    boxShadow: 'var(--dsw-shadow-lv1, 0 8px 30px rgba(0,0,0,.4))',
  }

  if (hidden) {
    return createElement(
      'button',
      {
        id: 'dsh-ce-status-reopen',
        style: reopenStyle,
        onClick: () => { setHidden(false); writeHidden(false) },
      },
      '🧊 CE',
    )
  }

  const panelStyle = {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 99999,
    width: 260,
    background: 'var(--dsw-alias-bg-layer-3, #1c1c1c)',
    color: 'var(--dsw-alias-label-primary, #eee)',
    border: '1px solid var(--dsw-alias-border-l2, #333)',
    borderRadius: 12,
    padding: '12px 14px',
    font: '12px/1.5 system-ui',
    boxShadow: 'var(--dsw-shadow-lv1, 0 8px 30px rgba(0,0,0,.4))',
  }
  const sumWrapStyle = {
    marginTop: 8,
    paddingTop: 8,
    borderTop: '1px solid var(--dsw-alias-border-l2, #333)',
  }
  const sumStyle = { color: 'var(--dsw-alias-label-tertiary, #999)', whiteSpace: 'pre-wrap' }
  const closeStyle = {
    position: 'absolute',
    top: 6,
    right: 10,
    cursor: 'pointer',
    color: 'var(--dsw-alias-label-tertiary, #999)',
    border: 'none',
    background: 'transparent',
    fontSize: 16,
    lineHeight: 1,
  }

  return createElement(
    'div',
    { id: 'dsh-ce-status-panel', style: panelStyle },
    createElement(
      'button',
      {
        'aria-label': 'Close CE status panel',
        style: closeStyle,
        onClick: () => { setHidden(true); writeHidden(true) },
      },
      '×',
    ),
    createElement('h3', { style: { margin: '0 0 8px', fontSize: 13 } }, '🧊 CE Status'),
    row('Phase', data.phase),
    row('Calls', data.call_count),
    row('Scan', data.scan_count),
    row('Locks', data.locked_addresses ? data.locked_addresses.length : 0),
    createElement(
      'div',
      { style: sumWrapStyle },
      createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, '总结'),
      createElement('div', { style: sumStyle }, data.summary || '暂无总结。运行 ce_analyst 可生成。'),
      data.recent_events && data.recent_events.length > 0
        ? createElement(
            'div',
            { style: { marginTop: 6, color: 'var(--dsw-alias-label-tertiary, #999)' } },
            createElement('div', { style: { fontWeight: 600, marginBottom: 2 } }, '最近'),
            ...data.recent_events.slice(0, 5).map((e) =>
              createElement('div', { key: e.ts ?? e.text, style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, `• ${e.text}`),
            ),
          )
        : null,
    ),
  )
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({
      name: 'shell.overlay',
      id: '@dsh-external/dsh-cheatengine-panel',
      label: () => 'CE Status',
    }, Panel),
  ), '@dsh-external/dsh-cheatengine: status panel')
}
