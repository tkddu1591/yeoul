import type { ChangeKind, CommitDetail, CommitFileChange } from '@git-gui/domain'

const FIELD_SEPARATOR = '\x1f'

/**
 * `git show -s --format=%H%x1f%h%x1f%an%x1f%ct%x1f%P%x1f%s%x1f%b` 출력을 파싱한다.
 * %s/%b로 제목·본문을 git이 분리한다 — %b는 마지막 필드라 개행을 포함해도 안전하다.
 * 단일 커밋 전용이므로 기형 출력은 건너뛰지 않고 에러를 던진다.
 */
export function parseCommitMeta(rawOutput: string): Omit<CommitDetail, 'files'> {
  const fields = rawOutput.split(FIELD_SEPARATOR)
  if (fields.length < 7) {
    throw new Error('커밋 정보를 읽지 못했어요. 새로고침 후 다시 시도해 주세요.')
  }
  const committedAt = Number(fields[3])
  if (!Number.isFinite(committedAt)) {
    throw new Error('커밋 정보를 읽지 못했어요. 새로고침 후 다시 시도해 주세요.')
  }
  return {
    hash: fields[0]!,
    shortHash: fields[1]!,
    authorName: fields[2]!,
    committedAt,
    parents: fields[4]! === '' ? [] : fields[4]!.split(' '),
    subject: fields[5]!,
    // 본문에 구분자가 섞이는 일은 없지만 방어적으로 나머지를 합친다. 끝 개행은 표시용이 아니다
    body: fields.slice(6).join(FIELD_SEPARATOR).replace(/\n+$/, ''),
  }
}

/** name-status 상태 문자 → ChangeKind. 커밋 diff에는 U(충돌)·미추적이 없다 */
const STATUS_KINDS: Record<string, ChangeKind> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
}

/**
 * `git diff --name-status -M -z` 출력을 파싱한다.
 * 레코드: `M NUL path NUL` / rename·copy: `R100 NUL 원래경로 NUL 새경로 NUL` (원래 경로가 먼저 — 실측 확정).
 * 알 수 없는 상태는 추측하지 않고 건너뛴다.
 */
export function parseNameStatus(rawOutput: string): CommitFileChange[] {
  const tokens = rawOutput.split('\0')
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop()

  const files: CommitFileChange[] = []
  let index = 0
  while (index < tokens.length) {
    const status = tokens[index]!
    const kind = STATUS_KINDS[status[0] ?? '']
    const twoPaths = status.startsWith('R') || status.startsWith('C')
    const consumed = twoPaths ? 3 : 2
    if (kind === undefined || index + consumed > tokens.length) {
      index += consumed
      continue
    }
    if (twoPaths) {
      files.push({ path: tokens[index + 2]!, origPath: tokens[index + 1]!, kind })
    } else {
      files.push({ path: tokens[index + 1]!, origPath: null, kind })
    }
    index += consumed
  }
  return files
}
