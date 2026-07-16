import type { CommitSummary } from '@git-gui/domain'

const FIELD_SEPARATOR = '\x1f'

/**
 * `git log --format=%H%x1f%h%x1f%an%x1f%ct%x1f%s -z` 출력을 파싱한다.
 * 레코드는 NUL, 필드는 US(0x1f)로 구분된다. %s(subject)는 git이 한 줄로 정리해 준다.
 * 기형 레코드는 추측해 채우지 않고 건너뛴다.
 */
export function parseLog(rawOutput: string): CommitSummary[] {
  const records = rawOutput.split('\0')
  if (records.length > 0 && records[records.length - 1] === '') records.pop()

  const commits: CommitSummary[] = []
  for (const record of records) {
    const fields = record.split(FIELD_SEPARATOR)
    if (fields.length < 5) continue
    const committedAt = Number(fields[3])
    if (!Number.isFinite(committedAt)) continue
    commits.push({
      hash: fields[0]!,
      shortHash: fields[1]!,
      authorName: fields[2]!,
      committedAt,
      // subject에 구분자가 섞이는 일은 없지만 방어적으로 나머지를 합친다
      subject: fields.slice(4).join(FIELD_SEPARATOR),
    })
  }
  return commits
}
