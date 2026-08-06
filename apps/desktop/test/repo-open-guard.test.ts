/**
 * `repo:open`의 순수부 (E15a 리뷰 ③④) — worktree-open-guard.test.ts 관례.
 *
 * 아래 오류 코드는 전부 **실측**이다(node spawn/fs, macOS):
 * - 없는 디렉터리를 cwd로 spawn → `code=ENOENT, syscall='spawn git', path='git'`
 * - PATH에 git이 없어서 spawn 실패 → **위와 바이트까지 같다**
 * - 파일을 cwd로 spawn → 동기 throw `ENOTDIR`
 * - 70,000자 경로 → 동기 throw `ENAMETOOLONG`
 * - `cwd: ''` / `'.'` / 상대 경로 → 아무 오류 없이 **main의 process.cwd()에서 실행**된다
 *   (실측: `cwd=''` → exit 0, stdout `"true"`)
 *
 * 첫 두 줄이 이 파일의 존재 이유다 — spawn 오류 코드로 "폴더가 없다"를 판정하면 git이 안 깔린
 * 머신에서 최근 목록이 통째로 지워진다. 그래서 폴더 존재는 fs.stat에게만 묻는다.
 */
import { describe, expect, it } from 'vitest'
import {
  assertAbsoluteRepoPath,
  isMissingDirectoryError,
  repoGone,
  repoNotARepository,
  repoOpenUnchecked,
} from '../src/main/repo-open-guard'

describe('assertAbsoluteRepoPath — 절대 경로만 통과 (E15a 리뷰 ③)', () => {
  it('절대 경로는 그대로 돌려준다', () => {
    expect(assertAbsoluteRepoPath('/Users/me/project')).toBe('/Users/me/project')
  })

  it('빈 문자열을 거부한다 — spawn이 main의 process.cwd()로 해석해 앱 자신의 저장소를 연다', () => {
    expect(() => assertAbsoluteRepoPath('')).toThrow(/잘못된 요청 형식이에요/)
  })

  it('점·상대 경로를 거부한다 — 같은 이유다', () => {
    expect(() => assertAbsoluteRepoPath('.')).toThrow(/잘못된 요청 형식이에요/)
    expect(() => assertAbsoluteRepoPath('../..')).toThrow(/잘못된 요청 형식이에요/)
    expect(() => assertAbsoluteRepoPath('projects/app')).toThrow(/잘못된 요청 형식이에요/)
  })

  it('문자열이 아닌 값을 거부한다 (assertString 관례 유지)', () => {
    expect(() => assertAbsoluteRepoPath(null)).toThrow(/잘못된 요청 형식이에요/)
    expect(() => assertAbsoluteRepoPath(42)).toThrow(/잘못된 요청 형식이에요/)
  })
})

describe('isMissingDirectoryError — "정말 없다"와 "모르겠다"를 가른다 (E15a 리뷰 ④)', () => {
  it('ENOENT·ENOTDIR만 "정말 없다"다', () => {
    expect(isMissingDirectoryError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(true)
    expect(isMissingDirectoryError(Object.assign(new Error('x'), { code: 'ENOTDIR' }))).toBe(true)
  })

  it('권한·이름 길이·미마운트는 "모르겠다"로 남긴다 — 멀쩡한 저장소를 목록에서 날리지 않는다', () => {
    expect(isMissingDirectoryError(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(false)
    expect(isMissingDirectoryError(Object.assign(new Error('x'), { code: 'ENAMETOOLONG' }))).toBe(
      false,
    )
    expect(isMissingDirectoryError(Object.assign(new Error('x'), { code: 'EIO' }))).toBe(false)
  })

  it('코드가 없는 값도 "모르겠다"다 (null·문자열 포함 — 여기서 throw하면 안 된다)', () => {
    expect(isMissingDirectoryError(new Error('그냥 오류'))).toBe(false)
    expect(isMissingDirectoryError(null)).toBe(false)
    expect(isMissingDirectoryError('spawn git ENOENT')).toBe(false)
  })
})

describe('실패 결과 — reason이 목록 제거 여부를 정한다 (E15a 리뷰 ④)', () => {
  it('확실한 두 경우만 목록에서 뺄 수 있는 reason을 낸다', () => {
    expect(repoGone().reason).toBe('missing')
    expect(repoNotARepository().reason).toBe('not-a-repository')
  })

  it('확인 못 한 경우는 failed — 렌더러가 목록을 건드리지 않는 값이다', () => {
    expect(repoOpenUnchecked(new Error('spawn git ENOENT')).reason).toBe('failed')
  })

  it('failed 문구는 실제 원인 둘(디스크·git)을 알리고 원어 오류를 함께 담는다', () => {
    const message = repoOpenUnchecked(new Error('spawn git ENOENT')).message
    expect(message).toContain('디스크가 연결돼 있는지')
    expect(message).toContain('git이 설치돼 있는지')
    expect(message).toContain('목록은 그대로 둘게요')
    expect(message).toContain('spawn git ENOENT')
  })

  it('없어진 폴더와 저장소 아님은 서로 다른 문구다 — 사인을 단정하지 않는다', () => {
    expect(repoGone().message).toContain('그 폴더가 없어요')
    expect(repoNotARepository().message).toContain('이제 Git 저장소가 아니에요')
  })
})
