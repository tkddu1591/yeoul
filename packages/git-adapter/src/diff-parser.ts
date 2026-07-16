import type { DiffHunk, DiffLine, FileDiff } from '@git-gui/domain'

/**
 * 단일 파일 patch(`git diff -- <path>` 출력)를 FileDiff로 구조화한다.
 * 줄 번호는 @@ -a,b +c,d @@ 헤더에서 시작해 누적한다.
 * 위치 기반 분류 — 헤더 구간(첫 @@ 이전)은 meta, hunk 안 '-'/'+'는 내용이다.
 */
export function parsePatch(rawPatch: string): FileDiff {
  const lines = rawPatch.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const meta: string[] = []
  const hunks: DiffHunk[] = []
  let isBinary = false
  let current: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1])
      newLine = Number(hunkMatch[2])
      current = { header: line, lines: [] }
      hunks.push(current)
      continue
    }
    if (current === null) {
      if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
        isBinary = true
      }
      meta.push(line)
      continue
    }
    if (line.startsWith('\\')) {
      current.lines.push({ kind: 'note', oldLine: null, newLine: null, text: line })
      continue
    }
    if (line.startsWith('+')) {
      current.lines.push({ kind: 'add', oldLine: null, newLine, text: line.slice(1) })
      newLine += 1
      continue
    }
    if (line.startsWith('-')) {
      current.lines.push({ kind: 'del', oldLine, newLine: null, text: line.slice(1) })
      oldLine += 1
      continue
    }
    const entry: DiffLine = { kind: 'context', oldLine, newLine, text: line.slice(1) }
    current.lines.push(entry)
    oldLine += 1
    newLine += 1
  }

  return { meta, hunks, isBinary }
}
