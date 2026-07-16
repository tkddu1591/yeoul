import type { CommitSummary } from '@git-gui/domain'

const FIELD_SEPARATOR = '\x1f'

/**
 * `%D` 장식 문자열을 이름 배열로 정리한다.
 * "HEAD -> main, origin/main, tag: v1" → ['main', 'origin/main', 'v1'].
 * detached HEAD의 단독 "HEAD"와 shallow clone의 pseudo-decoration "grafted"는
 * ref가 아니므로 제외한다 (origin/HEAD·replace ref는 log 인자에서 장식 제외).
 */
function parseRefs(decoration: string): string[] {
  if (decoration === '') return []
  return decoration
    .split(', ')
    .map((ref) => {
      if (ref.startsWith('HEAD -> ')) return ref.slice('HEAD -> '.length)
      if (ref.startsWith('tag: ')) return ref.slice('tag: '.length)
      return ref
    })
    .filter((ref) => ref !== 'HEAD' && ref !== 'grafted')
}

/**
 * `git log --format=%H%x1f%h%x1f%an%x1f%ct%x1f%D%x1f%P%x1f%s -z` 출력을 파싱한다.
 * 레코드는 NUL, 필드는 US(0x1f)로 구분된다. %s(subject)는 git이 한 줄로 정리해 준다.
 * 기형 레코드는 추측해 채우지 않고 건너뛴다.
 */
export function parseLog(rawOutput: string): CommitSummary[] {
  const records = rawOutput.split('\0')
  if (records.length > 0 && records[records.length - 1] === '') records.pop()

  const commits: CommitSummary[] = []
  for (const record of records) {
    const fields = record.split(FIELD_SEPARATOR)
    if (fields.length < 7) continue
    const committedAt = Number(fields[3])
    if (!Number.isFinite(committedAt)) continue
    commits.push({
      hash: fields[0]!,
      shortHash: fields[1]!,
      authorName: fields[2]!,
      committedAt,
      refs: parseRefs(fields[4]!),
      parents: fields[5]! === '' ? [] : fields[5]!.split(' '),
      // subject에 구분자가 섞이는 일은 없지만 방어적으로 나머지를 합친다
      subject: fields.slice(6).join(FIELD_SEPARATOR),
    })
  }
  return commits
}
