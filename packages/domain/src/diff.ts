export type DiffLineKind = 'context' | 'add' | 'del' | 'note'

export interface DiffLine {
  kind: DiffLineKind
  /** 변경 전 파일의 줄 번호. add·note면 null */
  oldLine: number | null
  /** 변경 후 파일의 줄 번호. del·note면 null */
  newLine: number | null
  /** 접두 기호(+/-/공백)를 제거한 내용 */
  text: string
}

export interface DiffHunk {
  /** @@ -a,b +c,d @@ 원문 헤더 */
  header: string
  lines: DiffLine[]
}

export interface FileDiff {
  /** diff/index/mode 등 파일 메타 라인 원문 */
  meta: string[]
  hunks: DiffHunk[]
  /** 텍스트 diff가 없는 바이너리 변경 */
  isBinary: boolean
}
