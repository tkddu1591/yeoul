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

const darkIndex = css.indexOf(":root[data-color-mode='dark']")
const lightTokens = parseTokens(css.slice(0, darkIndex))

function parseSelectorTokens(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
  return parseTokens(block)
}

const modeTokens = {
  light: new Map(lightTokens),
  dark: new Map([
    ...lightTokens,
    ...parseSelectorTokens(":root[data-color-mode='dark']"),
  ]),
}

const appearances = [
  ['여울 라이트', 'yeoul', 'light'],
  ['여울 다크', 'yeoul', 'dark'],
  ['블루 라이트', 'blue', 'light'],
  ['블루 다크', 'blue', 'dark'],
  ['숲 라이트', 'forest', 'light'],
  ['숲 다크', 'forest', 'dark'],
  ['레트로 라이트', 'retro', 'light'],
  ['레트로 다크', 'retro', 'dark'],
  ['보랏빛 라이트', 'violet', 'light'],
  ['보랏빛 다크', 'violet', 'dark'],
] as const

const appearanceTokens = appearances.map(([label, theme, mode]) => [
  label,
  new Map([
    ...modeTokens[mode],
    ...parseSelectorTokens(`:root[data-theme='${theme}'][data-color-mode='${mode}']`),
  ]),
] as const)

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
  ['--color-accent-text', '--color-accent-active', 4.5],
  ['--color-danger', '--color-surface', 4.5],
  // E7g 인라인 ↑↓ — 평상시·선택 행 양쪽에서 텍스트 대비 (라이트·다크 공통 순회)
  ['--color-ahead', '--color-surface', 4.5],
  ['--color-behind', '--color-surface', 4.5],
  ['--color-ahead', '--color-selection-bg', 4.5],
  ['--color-behind', '--color-selection-bg', 4.5],
  ['--color-focus', '--color-surface', 3],
  ['--term-badge', '--term-badge-bg', 4.5],
  // 파일명 자체를 변경 종류 색으로 표기한다(IntelliJ식) — 본문 텍스트 기준 대비 필요.
  // 선택 행(selection-bg) 위에서도 읽혀야 한다 — 사용자가 지금 보고 있는 바로 그 행이다.
  ['--change-modified', '--color-surface', 4.5],
  ['--change-added', '--color-surface', 4.5],
  ['--change-deleted', '--color-surface', 4.5],
  ['--change-renamed', '--color-surface', 4.5],
  ['--change-untracked', '--color-surface', 4.5],
  ['--change-modified', '--color-selection-bg', 4.5],
  ['--change-added', '--color-selection-bg', 4.5],
  ['--change-deleted', '--color-selection-bg', 4.5],
  ['--change-renamed', '--color-selection-bg', 4.5],
  ['--change-untracked', '--color-selection-bg', 4.5],
  ['--concept-conflict', '--color-selection-bg', 4.5],
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

describe.each(appearanceTokens)('%s 테마 토큰 대비 (WCAG)', (_theme, tokens) => {
  it.each(PAIRS)('%s / %s ≥ %s:1', (foreground, background, minimum) => {
    const fg = tokens.get(foreground)
    const bg = tokens.get(background)
    expect(fg, `${foreground} 토큰이 없다`).toBeDefined()
    expect(bg, `${background} 토큰이 없다`).toBeDefined()
    expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(minimum)
  })
})

/**
 * E13 후속(리뷰 NOTE 7) — 부팅 창 배경색(main/index.ts의 APP_BACKGROUND)은 tokens.css의
 * `--color-bg`를 **손으로 베껴 둔 값**이다. E13 Task 4가 이 색으로 부팅 흰 화면을 없앴는데,
 * 토큰만 바꾸면 부팅 첫 프레임과 body 배경이 조용히 어긋난다(창이 뜨는 순간 잘못된 색이 잠깐
 * 보이고, 아무 테스트도 안 잡는다 — 실측으로 확인). 여기서 두 정본을 맞대어 못박는다.
 *
 * main/index.ts를 import하지 않고 소스 텍스트를 파싱하는 이유: 그 모듈은 최상단에서 electron을
 * import하고 app.setName 같은 부작용을 실행한다 — vitest(노드) 환경에서 로드되지 않는다.
 * motion-tokens.test.ts가 CSS를 텍스트로 읽어 안전망을 거는 것과 같은 관용구다.
 */
describe('부팅 창 배경색 (main/index.ts) ↔ --color-bg 토큰', () => {
  const mainSource = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
  const declaration = /const APP_BACKGROUND = \{([\s\S]*?)\n\} as const/.exec(mainSource)?.[1]
  const appBackground = new Map(
    [...(declaration ?? '').matchAll(/(\w+):\s*\{\s*light:\s*'(#[0-9a-fA-F]{6})',\s*dark:\s*'(#[0-9a-fA-F]{6})'/g)].flatMap(
      (match) => [
        [`${match[1]}-light`, match[2]!.toLowerCase()] as const,
        [`${match[1]}-dark`, match[3]!.toLowerCase()] as const,
      ],
    ),
  )

  it('APP_BACKGROUND 선언을 실제로 찾아냈다 (이 테스트가 조용히 무력화되지 않게)', () => {
    expect(declaration, 'main/index.ts에서 APP_BACKGROUND 선언을 못 찾았다').toBeDefined()
    expect(appBackground.size).toBe(10)
  })

  it.each(appearances)('%s — APP_BACKGROUND가 그 테마의 --color-bg와 같다', (label, theme, mode) => {
    const tokens = appearanceTokens.find(([candidate]) => candidate === label)![1]
    expect(appBackground.get(`${theme}-${mode}`)).toBe(tokens.get('--color-bg')!.toLowerCase())
  })
})
