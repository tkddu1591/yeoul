import { describe, expect, it } from 'vitest'
import { classifyLines } from '../src/renderer/src/components/diff-lines'

describe('classifyLines', () => {
  it('첫 @@ 이전의 헤더는 전부 meta다', () => {
    const tones = classifyLines([
      'diff --git a/f.sql b/f.sql',
      'index abc..def 100644',
      '--- a/f.sql',
      '+++ b/f.sql',
      '@@ -1,2 +1,2 @@',
    ])
    expect(tones).toEqual(['meta', 'meta', 'meta', 'meta', 'hunk'])
  })

  it("hunk 안의 '--'/'++' 시작 라인은 del/add로 분류한다 (SQL 주석·증감 연산)", () => {
    const tones = classifyLines(['@@ -1 +1 @@', '--- SQL comment', '+++counter', ' context'])
    expect(tones).toEqual(['hunk', 'del', 'add', 'context'])
  })

  it('rename·binary 등 hunk 없는 diff는 전부 meta다', () => {
    const tones = classifyLines([
      'diff --git a/old.ts b/new.ts',
      'similarity index 100%',
      'rename from old.ts',
      'rename to new.ts',
    ])
    expect(tones).toEqual(['meta', 'meta', 'meta', 'meta'])
  })

  it('개행 없음 마커는 meta다', () => {
    const tones = classifyLines(['@@ -1 +1 @@', '-old', '+new', '\\ No newline at end of file'])
    expect(tones).toEqual(['hunk', 'del', 'add', 'meta'])
  })

  it('여러 파일 diff에서 새 파일 헤더가 나오면 다시 meta 구간이 된다', () => {
    const tones = classifyLines(['@@ -1 +1 @@', '-a', 'diff --git a/b b/b', 'index 1..2'])
    expect(tones).toEqual(['hunk', 'del', 'meta', 'meta'])
  })
})
