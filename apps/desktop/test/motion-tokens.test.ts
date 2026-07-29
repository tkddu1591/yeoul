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

/** 애니메이션하면 매 프레임 레이아웃을 다시 계산해 버벅인다 — 색·투명도·transform만 쓴다.
 * 축약형(margin)뿐 아니라 하이픈 변형(margin-bottom)까지 각각 명시한다 — "margin"이라는
 * 부분 문자열 포함 여부로 판정하면 grid-template-rows(허용 예외) 같은 값이 오탐될 수 있고,
 * 반대로 문자열 경계를 놓치면 margin-bottom 같은 변형을 놓친다(E11 마무리 Important 2 실측:
 * 안전망이 놓친 5개 구멍 중 하나가 정확히 이 케이스 — layout.css:296-298의 margin-bottom).
 * line-height는 텍스트 줄 높이를 바꿔 리플로우를 일으키는 진짜 레이아웃 속성이라 포함한다
 * (금지 쪽으로 결정 — 근거는 파일 하단 주석) */
const LAYOUT_PROPS = new Set([
  'height',
  'min-height',
  'max-height',
  'width',
  'min-width',
  'max-width',
  'top',
  'left',
  'right',
  'bottom',
  'inset',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'flex-basis',
  'gap',
  'row-gap',
  'column-gap',
  'grid-template-columns',
  'grid-template-areas',
  'grid-template',
  'grid-column',
  'grid-column-start',
  'grid-column-end',
  'grid-row',
  'grid-row-start',
  'grid-row-end',
  'border-width',
  'line-height',
])

/** grid-template-rows만 유일한 의도적 예외 — 상세 슬롯 열림에 쓴다(E11 스펙). 정확히 이
 * 토큰일 때만 허용한다: `transition: grid-template-rows, height`처럼 다른 항목과 나란히 오면
 * 그 다른 항목은 그대로 걸린다(허용은 항목 단위지 선언 전체 단위가 아니다) */
const ALLOWED_EXACT = 'grid-template-rows'

/** `200ms ease` 처럼 속성명이 생략된 항목 — shorthand에서 속성 생략은 all과 동치라 위험하다 */
const BARE_TIME = /^-?\d*\.?\d+m?s$/i

/** 괄호 안(예: cubic-bezier(0.2, 0, 0, 1))의 콤마는 항목 구분자가 아니다 */
function splitTopLevel(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts
}

/** 각 항목(콤마로 나눈 한 조각)에서 속성명을 뽑는다. transition shorthand는 "속성 시간 이징"
 * 순서를 이 코드베이스 관례로 가정(속성이 항상 먼저 온다) — transition-property 값은 항목 자체가
 * 이미 속성명이라 동일 로직이 그대로 맞는다(공백 분리 첫 토큰 = 전체) */
function propertyToken(entry: string): string {
  const trimmed = entry.trim()
  if (!trimmed) return ''
  const first = trimmed.split(/\s+/)[0].toLowerCase()
  if (BARE_TIME.test(first)) return 'all' // 속성 생략 = 전체 속성 취급
  return first
}

/** `prop: value;`뿐 아니라 블록의 마지막 선언(세미콜론 없이 `}`로 끝남)도 잡는다 —
 * 대소문자 무시(`TRANSITION:`도 잡아야 한다) */
function extractDeclarationValues(text: string, propertyName: string): string[] {
  const re = new RegExp(`${propertyName}\\s*:\\s*([^;}]+)[;}]`, 'gi')
  return [...text.matchAll(re)].map((m) => m[1])
}

interface Violation {
  path: string
  detail: string
}

function collectTransitionViolations(): { layout: Violation[]; all: Violation[] } {
  const layout: Violation[] = []
  const all: Violation[] = []

  for (const { path, text } of files) {
    const declarations = [
      ...extractDeclarationValues(text, 'transition').map((v) => ({ kind: 'transition', value: v })),
      ...extractDeclarationValues(text, 'transition-property').map((v) => ({
        kind: 'transition-property',
        value: v
      }))
    ]

    for (const { kind, value } of declarations) {
      for (const entry of splitTopLevel(value)) {
        const prop = propertyToken(entry)
        if (!prop || prop === ALLOWED_EXACT) continue
        if (prop === 'all') {
          all.push({ path, detail: `${kind}: ${value.trim()}` })
          continue
        }
        if (LAYOUT_PROPS.has(prop)) {
          layout.push({ path, detail: `${kind}: ${value.trim()} (${prop})` })
        }
      }
    }
  }

  return { layout, all }
}

/** @keyframes 본문은 transition을 쓰지 않으므로 위 스캔에 전혀 걸리지 않는다 — 별도로
 * 블록을 괄호 매칭으로 통째로 잘라내 그 안의 모든 `prop: value` 선언을 직접 검사한다.
 * 선택자(from/to/50% 등)는 콜론이 없어 자연히 걸러진다 */
function keyframeBodies(text: string): string[] {
  const bodies: string[] = []
  const opener = /@keyframes\s+[\w-]+\s*\{/gi
  let match: RegExpExecArray | null
  while ((match = opener.exec(text))) {
    let depth = 1
    let i = match.index + match[0].length
    const start = i
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth += 1
      if (text[i] === '}') depth -= 1
      i += 1
    }
    bodies.push(text.slice(start, i - 1))
  }
  return bodies
}

function collectKeyframeViolations(): Violation[] {
  const violations: Violation[] = []
  const declRe = /([a-zA-Z-]+)\s*:\s*[^;}]+[;}]/g
  for (const { path, text } of files) {
    for (const body of keyframeBodies(text)) {
      for (const m of body.matchAll(declRe)) {
        const prop = m[1].toLowerCase()
        if (LAYOUT_PROPS.has(prop)) {
          violations.push({ path, detail: `@keyframes ... { ${m[0].trim()} }` })
        }
      }
    }
  }
  return violations
}

describe('모션 안전망', () => {
  it('레이아웃 속성에 transition을 걸지 않는다 — grid-template-rows만 의도된 예외', () => {
    const { layout } = collectTransitionViolations()
    expect(layout.map((v) => `${v.path}: ${v.detail}`)).toEqual([])
  })

  it('transition: all(속성 생략 포함)을 쓰지 않는다 — 의도치 않은 속성까지 걸려 원인 추적이 불가능해진다', () => {
    const { all } = collectTransitionViolations()
    expect(all.map((v) => `${v.path}: ${v.detail}`)).toEqual([])
  })

  it('@keyframes 본문에서 레이아웃 속성을 직접 애니메이션하지 않는다', () => {
    const violations = collectKeyframeViolations()
    expect(violations.map((v) => `${v.path}: ${v.detail}`)).toEqual([])
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
