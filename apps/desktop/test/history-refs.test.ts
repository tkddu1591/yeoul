import { describe, expect, it } from 'vitest'
import { arrangeRefs } from '../src/renderer/src/components/history-refs'

describe('arrangeRefs', () => {
  it('현재 브랜치 > 로컬 > 원격(origin/) 순으로 정렬해 상위 2개만 보이고 나머지는 접는다', () => {
    const result = arrangeRefs(['origin/main', 'feature/login', 'main', 'v1.0'], 'main')
    expect(result.visible).toEqual(['main', 'feature/login'])
    // v1.0(태그)은 파서가 tag: 접두를 벗겨 구분 불가 — 로컬과 동급(원격보다 앞)
    expect(result.hidden).toEqual(['v1.0', 'origin/main'])
  })

  it('2개 이하면 전부 보이고 접힘이 없다', () => {
    expect(arrangeRefs(['main'], 'main')).toEqual({ visible: ['main'], hidden: [] })
    expect(arrangeRefs([], null)).toEqual({ visible: [], hidden: [] })
  })

  it('현재 브랜치가 없으면 로컬 우선 정렬만 적용한다', () => {
    const result = arrangeRefs(['origin/a', 'b', 'origin/c', 'd'], null)
    expect(result.visible).toEqual(['b', 'd'])
    expect(result.hidden).toEqual(['origin/a', 'origin/c'])
  })

  it('같은 우선순위 안에서는 입력 순서를 유지한다 (안정 정렬)', () => {
    const result = arrangeRefs(['z-branch', 'a-branch', 'main'], 'main')
    expect(result.visible).toEqual(['main', 'z-branch'])
    expect(result.hidden).toEqual(['a-branch'])
  })
})
