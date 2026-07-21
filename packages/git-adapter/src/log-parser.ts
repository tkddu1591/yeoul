import type { CommitSummary } from '@git-gui/domain'

const FIELD_SEPARATOR = '\x1f'

interface ParsedDecoration {
  refs: string[]
  tags: string[]
}

/**
 * `%D` 장식 문자열을 이름 배열로 정리한다.
 * "HEAD -> main, origin/main, tag: v1" → refs ['main', 'origin/main', 'v1'], tags ['v1'].
 * `tag: ` 접두는 벗기되 tags로 따로 보존한다 — 배지 모양(🏷)·우선순위 하위 분류용 (E4 후속, E6b).
 * detached HEAD의 단독 "HEAD"와 shallow clone의 pseudo-decoration "grafted"는
 * ref가 아니므로 제외한다 (origin/HEAD·replace ref는 log 인자에서 장식 제외).
 */
function parseRefs(decoration: string): ParsedDecoration {
  const refs: string[] = []
  const tags: string[] = []
  if (decoration === '') return { refs, tags }
  for (const entry of decoration.split(', ')) {
    let ref = entry
    if (ref.startsWith('HEAD -> ')) ref = ref.slice('HEAD -> '.length)
    const isTag = ref.startsWith('tag: ')
    if (isTag) ref = ref.slice('tag: '.length)
    if (ref === 'HEAD' || ref === 'grafted') continue
    refs.push(ref)
    if (isTag) tags.push(ref)
  }
  return { refs, tags }
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
    const { refs, tags } = parseRefs(fields[4]!)
    commits.push({
      hash: fields[0]!,
      shortHash: fields[1]!,
      authorName: fields[2]!,
      committedAt,
      refs,
      tags,
      parents: fields[5]! === '' ? [] : fields[5]!.split(' '),
      // subject에 구분자가 섞이는 일은 없지만 방어적으로 나머지를 합친다
      subject: fields.slice(6).join(FIELD_SEPARATOR),
    })
  }
  return commits
}
