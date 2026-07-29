import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS_ROOT = join(__dirname, '../src/renderer/src')

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return path.endsWith('.css') ? [path] : []
  })
}

const files = cssFiles(CSS_ROOT).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
const tokens = readFileSync(join(CSS_ROOT, 'ui/tokens.css'), 'utf8')

/** 애니메이션하면 매 프레임 레이아웃을 다시 계산해 버벅인다 — 색·투명도·transform만 쓴다 */
const LAYOUT_PROPS = [
  'height',
  'width',
  'top',
  'left',
  'right',
  'bottom',
  'margin',
  'padding',
  'flex-basis',
  'gap',
]

describe('모션 안전망', () => {
  it('레이아웃 속성에 transition을 걸지 않는다 — grid-template-rows만 의도된 예외', () => {
    const offenders: string[] = []
    for (const { path, text } of files) {
      for (const match of text.matchAll(/transition:\s*([^;]+);/g)) {
        const value = match[1]
        // grid-template-rows는 Chromium이 보간하는 몇 안 되는 경로 — 상세 슬롯 열림에 쓴다(E11 스펙)
        const cleaned = value.replace(/grid-template-rows/g, '')
        for (const prop of LAYOUT_PROPS) {
          if (new RegExp(`(^|[\\s,])${prop}([\\s,]|$)`).test(cleaned)) {
            offenders.push(`${path}: transition: ${value}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('transition: all을 쓰지 않는다 — 의도치 않은 속성까지 걸려 원인 추적이 불가능해진다', () => {
    const offenders = files
      .filter(({ text }) => /transition:\s*all\b/.test(text))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  it('모션 토큰이 정의돼 있다', () => {
    for (const token of ['--motion-fast', '--motion-base', '--motion-slow', '--ease-out', '--ease-in-out']) {
      expect(tokens).toContain(`${token}:`)
    }
  })

  it('가장 긴 모션도 240ms를 넘지 않는다 — 200ms를 넘기면 부드러운 게 아니라 느린 것이다', () => {
    const durations = [...tokens.matchAll(/--motion-[a-z]+:\s*(\d+)ms/g)].map((m) => Number(m[1]))
    expect(durations.length).toBeGreaterThan(0)
    expect(Math.max(...durations)).toBeLessThanOrEqual(240)
  })

  it('prefers-reduced-motion 전역 차단이 있다', () => {
    const base = readFileSync(join(CSS_ROOT, 'ui/base.css'), 'utf8')
    expect(base).toContain('prefers-reduced-motion')
  })
})
