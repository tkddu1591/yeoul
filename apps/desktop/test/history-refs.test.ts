import { describe, expect, it } from 'vitest'
import { arrangeRefs, isRemoteRef, refBadgeLabel } from '../src/renderer/src/components/history-refs'

describe('arrangeRefs', () => {
  it('현재 브랜치 > 로컬 > 원격(origin/) > 태그 순으로 정렬하고, 접힘이 생기면 1개만 보여준다', () => {
    const result = arrangeRefs(['origin/main', 'feature/login', 'main', 'v1.0'], 'main', ['v1.0'])
    // 3개 이상이면 배지끼리 폭을 나눠 갖다 전부 말줄임된다 — 최상위 1개만 온전히 (품질 리뷰 실측)
    expect(result.visible).toEqual(['main'])
    // 태그는 원격 뒤 — E4 때 파서가 접두를 벗겨 불가했던 하위 분류 (E6b tags로 완성)
    expect(result.hidden).toEqual(['feature/login', 'origin/main', 'v1.0'])
  })

  it('tags를 안 넘기면 기존 동작 그대로다 (태그가 로컬과 동급 — 하위 호환)', () => {
    const result = arrangeRefs(['origin/main', 'feature/login', 'main', 'v1.0'], 'main')
    expect(result.visible).toEqual(['main'])
    expect(result.hidden).toEqual(['feature/login', 'v1.0', 'origin/main'])
  })

  it('2개 이하면 전부 보이고 접힘이 없다', () => {
    expect(arrangeRefs(['main'], 'main')).toEqual({ visible: ['main'], hidden: [] })
    expect(arrangeRefs([], null)).toEqual({ visible: [], hidden: [] })
  })

  it('현재 브랜치가 없으면 로컬 우선 정렬만 적용한다', () => {
    const result = arrangeRefs(['origin/a', 'b', 'origin/c', 'd'], null)
    expect(result.visible).toEqual(['b'])
    expect(result.hidden).toEqual(['d', 'origin/a', 'origin/c'])
  })

  it('같은 우선순위 안에서는 입력 순서를 유지한다 (안정 정렬)', () => {
    const result = arrangeRefs(['z-branch', 'a-branch', 'main'], 'main')
    expect(result.visible).toEqual(['main'])
    expect(result.hidden).toEqual(['z-branch', 'a-branch'])
  })
})

describe('isRemoteRef', () => {
  it('origin/ 접두만 원격으로 본다 (E4 휴리스틱 — refPriority와 동일 기준)', () => {
    expect(isRemoteRef('origin/main')).toBe(true)
    expect(isRemoteRef('main')).toBe(false)
  })

  it('폴더형 로컬 이름(feature/a)은 원격이 아니다', () => {
    expect(isRemoteRef('feature/login')).toBe(false)
    expect(isRemoteRef('origin/feature/login')).toBe(true)
  })
})

describe('refBadgeLabel', () => {
  it('태그는 🏷, 원격은 ☁ 접두 — 로컬은 민무늬 (3분 구분)', () => {
    expect(refBadgeLabel('v1.0', ['v1.0'])).toBe('🏷 v1.0')
    expect(refBadgeLabel('origin/main', [])).toBe('☁ origin/main')
    expect(refBadgeLabel('main', [])).toBe('main')
  })

  it('태그 판정이 원격 휴리스틱보다 우선한다 (origin/ 모양의 태그 이름)', () => {
    expect(refBadgeLabel('origin/x', ['origin/x'])).toBe('🏷 origin/x')
  })
})
