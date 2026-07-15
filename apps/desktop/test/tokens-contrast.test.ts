import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 토큰 CSS가 디자인 정본이다 — 여기서 WCAG 대비를 고정해 색 회귀를 막는다
const css = readFileSync(join(__dirname, '../src/renderer/src/ui/tokens.css'), 'utf8')

function parseTokens(block: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const match of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    map.set(match[1]!, match[2]!)
  }
  return map
}

const mediaIndex = css.indexOf('@media')
const lightTokens = parseTokens(css.slice(0, mediaIndex))
const darkTokens = new Map([...lightTokens, ...parseTokens(css.slice(mediaIndex))])

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(foreground: string, background: string): number {
  const [bright, dim] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (bright! + 0.05) / (dim! + 0.05)
}

/** [전경 토큰, 배경 토큰, 최소 대비] — 텍스트 4.5:1, 비텍스트(포커스 링) 3:1 */
const PAIRS: Array<[string, string, number]> = [
  ['--color-text', '--color-surface', 4.5],
  ['--color-text-muted', '--color-surface', 4.5],
  ['--color-text-faint', '--color-surface', 4.5],
  ['--color-accent-text', '--color-accent', 4.5],
  ['--color-danger', '--color-surface', 4.5],
  ['--color-focus', '--color-surface', 3],
  ['--concept-mine', '--concept-mine-bg', 4.5],
  ['--concept-branch', '--concept-branch-bg', 4.5],
  ['--concept-commit', '--concept-commit-bg', 4.5],
  ['--concept-shelf', '--concept-shelf-bg', 4.5],
  ['--concept-backup', '--concept-backup-bg', 4.5],
  ['--concept-conflict', '--concept-conflict-bg', 4.5],
  ['--diff-add-text', '--diff-add-bg', 4.5],
  ['--diff-del-text', '--diff-del-bg', 4.5],
  ['--diff-hunk-text', '--diff-hunk-bg', 4.5],
]

describe.each([
  ['라이트', lightTokens],
  ['다크', darkTokens],
] as const)('%s 테마 토큰 대비 (WCAG)', (_theme, tokens) => {
  it.each(PAIRS)('%s / %s ≥ %s:1', (foreground, background, minimum) => {
    const fg = tokens.get(foreground)
    const bg = tokens.get(background)
    expect(fg, `${foreground} 토큰이 없다`).toBeDefined()
    expect(bg, `${background} 토큰이 없다`).toBeDefined()
    expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(minimum)
  })
})
