import { describe, expect, it } from 'vitest'
import { parsePatch } from '../src/diff-parser'

const SAMPLE = [
  'diff --git a/f.ts b/f.ts',
  'index abc..def 100644',
  '--- a/f.ts',
  '+++ b/f.ts',
  '@@ -1,3 +1,3 @@',
  ' context1',
  '-old line',
  '+new line',
  ' context2',
].join('\n')

describe('parsePatch', () => {
  it('빈 입력이면 빈 diff', () => {
    expect(parsePatch('')).toEqual({ meta: [], hunks: [], isBinary: false })
  })

  it('메타·hunk·줄 번호를 구조화한다', () => {
    const diff = parsePatch(SAMPLE)
    expect(diff.meta).toEqual([
      'diff --git a/f.ts b/f.ts',
      'index abc..def 100644',
      '--- a/f.ts',
      '+++ b/f.ts',
    ])
    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0]?.header).toBe('@@ -1,3 +1,3 @@')
    expect(diff.hunks[0]?.lines).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: 'context1' },
      { kind: 'del', oldLine: 2, newLine: null, text: 'old line' },
      { kind: 'add', oldLine: null, newLine: 2, text: 'new line' },
      { kind: 'context', oldLine: 3, newLine: 3, text: 'context2' },
    ])
  })

  it('여러 hunk의 줄 번호가 각 헤더에서 다시 시작한다', () => {
    const raw = [
      'diff --git a/f.ts b/f.ts',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
      '@@ -10,2 +10,1 @@',
      ' keep',
      '-drop',
    ].join('\n')
    const diff = parsePatch(raw)
    expect(diff.hunks[1]?.lines).toEqual([
      { kind: 'context', oldLine: 10, newLine: 10, text: 'keep' },
      { kind: 'del', oldLine: 11, newLine: null, text: 'drop' },
    ])
  })

  it("hunk 안의 '--'/'++' 시작 라인은 내용으로 분류한다 (위치 기반)", () => {
    const raw = ['@@ -1,1 +1,1 @@', '--- SQL comment', '+++counter'].join('\n')
    const diff = parsePatch(raw)
    expect(diff.hunks[0]?.lines.map((l) => l.kind)).toEqual(['del', 'add'])
    expect(diff.hunks[0]?.lines[0]?.text).toBe('-- SQL comment')
  })

  it('개행 없음 마커는 note로 분류한다', () => {
    const raw = ['@@ -1,1 +1,1 @@', '-old', '+new', '\\ No newline at end of file'].join('\n')
    const diff = parsePatch(raw)
    expect(diff.hunks[0]?.lines[2]).toEqual({
      kind: 'note',
      oldLine: null,
      newLine: null,
      text: '\\ No newline at end of file',
    })
  })

  it('바이너리 diff는 isBinary로 표시한다', () => {
    const raw = ['diff --git a/img.png b/img.png', 'Binary files a/img.png and b/img.png differ'].join(
      '\n',
    )
    const diff = parsePatch(raw)
    expect(diff.isBinary).toBe(true)
    expect(diff.hunks).toEqual([])
  })

  it('마지막 빈 줄(trailing newline)은 라인으로 세지 않는다', () => {
    const diff = parsePatch(SAMPLE + '\n')
    expect(diff.hunks[0]?.lines).toHaveLength(4)
  })
})
