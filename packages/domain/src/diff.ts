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

/** 화면에 표시한 한 hunk를 현재 index/worktree에 그대로 적용하기 위한 요청. */
export interface HunkStageRequest {
  path: string
  options: {
    staged: boolean
    untracked: boolean
    origPath?: string | null
  }
  /** 실행 시 최신 diff에 완전히 같은 hunk가 있는지 다시 확인해 stale 적용을 막는다. */
  hunk: DiffHunk
}

/** hunk 안의 한 추가/삭제 줄만 부분 적용한다. lineIndex는 hunk.lines 기준이다. */
export interface LineStageRequest extends HunkStageRequest {
  lineIndex: number
}
