import { describe, expect, it } from 'vitest'
import {
  buildMainColumns,
  buildMainRows,
  MAIN_DOCK_GRID_COLUMN,
  MAIN_DOCK_GRID_ROW,
  MAIN_GAP,
  MAIN_ROW_COUNT,
  MAIN_TRACK_COUNT,
  RESIZER_WIDTH,
} from '../src/renderer/src/ui/grid-tracks'
import { computeColumns } from '../src/renderer/src/ui/column-resize'

/**
 * E13 후속(리뷰 NOTE 5) — 아래 트랙 문자열 테스트들은 기대값을 상수 자신으로 쓴다(`${MAIN_GAP}px`).
 * 그래서 상수를 바꾸면 기대값도 같이 바뀌어 **항진명제**가 된다 — 실측: MAIN_GAP만 16→24로
 * 바꿨더니 이 파일 10건은 물론 루트 555건 전부가 그대로 통과했다. 값 자체를 여기서 리터럴로
 * 못박아야 조용한 변경이 잡힌다. 리터럴은 CSS 쪽 정본과 짝이다:
 *   - MAIN_GAP 16 ↔ layout.css `.app__main`의 폴백 트랙 문자열·`--space-4`
 *   - RESIZER_WIDTH 6 ↔ layout.css `.app__resizer`가 올라앉는 5번 트랙 폭
 *   - MAIN_ROW_COUNT 3 ↔ layout.css `.app__left`의 `grid-row: 1 / 4`
 * (e2e는 간격이 커지는 쪽만 잡는다 — 작아지면 아무도 못 잡았다)
 */
describe('레이아웃 상수 (CSS와 짝 — 리터럴로 못박는다)', () => {
  it('MAIN_GAP은 16 — layout.css의 --space-4·폴백 트랙과 같은 값', () => {
    expect(MAIN_GAP).toBe(16)
  })

  it('RESIZER_WIDTH는 6 — layout.css .app__resizer가 사는 트랙 폭', () => {
    expect(RESIZER_WIDTH).toBe(6)
  })

  it('MAIN_TRACK_COUNT는 7 · MAIN_ROW_COUNT는 3 — CSS의 grid-column/grid-row 리터럴과 짝', () => {
    expect(MAIN_TRACK_COUNT).toBe(7)
    expect(MAIN_ROW_COUNT).toBe(3)
    expect(MAIN_DOCK_GRID_COLUMN).toBe('3 / 8')
    expect(MAIN_DOCK_GRID_ROW).toBe('3')
  })

  it('column-resize가 쓰는 간격도 같은 정본이다 — 반응형 계산이 MAIN_GAP을 따라 움직인다', () => {
    // 1200px 창·양쪽 펼침: chrome = 패딩 40 + 간격 3칸 + 리사이저 6.
    // 좌 = min(380, 1200 - chrome - 380(중앙 최소) - 우측). MAIN_GAP이 정본이 아니면
    // 여기 유도식이 실제 계산과 어긋나 이 단언이 깨진다
    const chrome = 40 + 3 * MAIN_GAP + RESIZER_WIDTH
    const { left, right } = computeColumns(1200, 360, {})
    expect(right).toBe(360)
    expect(left).toBe(Math.min(380, 1200 - chrome - 380 - right))
  })
})

/** 트랙 문자열의 px 합 — 간격을 트랙으로 옮겼으므로 합이 곧 콘텐츠 폭이어야 한다 */
function sum(template: string): number {
  return template
    .split(' ')
    .filter((t) => t.endsWith('px'))
    .reduce((total, t) => total + Number(t.replace('px', '')), 0)
}

describe('buildMainColumns', () => {
  it('둘 다 펼침 — 좌·간격·중앙·간격·리사이저·간격·우 순서', () => {
    const template = buildMainColumns({ left: 380, right: 360 }, {})
    expect(template).toBe(
      `380px ${MAIN_GAP}px minmax(0, 1fr) ${MAIN_GAP}px ${RESIZER_WIDTH}px ${MAIN_GAP}px 360px`,
    )
  })

  it('좌측 접힘 — 트랙을 빼지 않고 0으로 둔다(전환의 시작점이 있어야 한다)', () => {
    const template = buildMainColumns({ left: 0, right: 360 }, { left: true })
    expect(template.startsWith('0px 0px minmax(0, 1fr)')).toBe(true)
  })

  it('우측 접힘 — 리사이저와 그 간격까지 0이다', () => {
    const template = buildMainColumns({ left: 380, right: 0 }, { right: true })
    expect(template).toBe(`380px ${MAIN_GAP}px minmax(0, 1fr) 0px 0px 0px 0px`)
  })

  it('양쪽 접힘 — 중앙만 남는다', () => {
    expect(buildMainColumns({ left: 0, right: 0 }, { left: true, right: true })).toBe(
      '0px 0px minmax(0, 1fr) 0px 0px 0px 0px',
    )
  })

  it('트랙 개수는 접힘과 무관하게 항상 같다 — 개수가 변하면 보간이 아니라 점프가 된다', () => {
    const count = (t: string) => t.split(' ').length
    const open = count(buildMainColumns({ left: 380, right: 360 }, {}))
    expect(count(buildMainColumns({ left: 0, right: 360 }, { left: true }))).toBe(open)
    expect(count(buildMainColumns({ left: 380, right: 0 }, { right: true }))).toBe(open)
    expect(count(buildMainColumns({ left: 0, right: 0 }, { left: true, right: true }))).toBe(open)
  })

  it('펼침 상태의 px 합 = 열 + 간격 3 + 리사이저', () => {
    expect(sum(buildMainColumns({ left: 380, right: 360 }, {}))).toBe(
      380 + 360 + MAIN_GAP * 3 + RESIZER_WIDTH,
    )
  })
})

describe('buildMainRows', () => {
  it('열림 — 콘텐츠·간격·도크 3트랙, 간격은 MAIN_GAP, 도크는 지정 높이', () => {
    expect(buildMainRows(true, 240)).toBe(`minmax(0, 1fr) ${MAIN_GAP}px 240px`)
  })

  it('닫힘 — 트랙을 빼지 않고 간격·도크 모두 0으로 둔다(전환의 시작점이 있어야 한다)', () => {
    expect(buildMainRows(false, 240)).toBe('minmax(0, 1fr) 0px 0px')
  })

  it('닫힘일 땐 저장된 높이가 몇이든 도크 트랙은 항상 0이다', () => {
    expect(buildMainRows(false, 600)).toBe('minmax(0, 1fr) 0px 0px')
  })

  it('트랙 개수는 열림·닫힘과 무관하게 항상 같다', () => {
    const count = (t: string) => t.split(' ').length
    expect(count(buildMainRows(true, 240))).toBe(count(buildMainRows(false, 240)))
  })
})
