import { isAbsolute } from 'node:path'
import type { RepoOpenResult } from '@git-gui/ipc-contract'

/**
 * 최근 목록에서 고른 경로를 여는 `repo:open`의 순수부 (E15a 리뷰 ③④).
 * electron 무의존 — 단위 테스트 가능. 실패 메시지는 사용자에게 그대로 보인다
 * (worktree-open-guard.ts 관례).
 */

export type RepoOpenFailure = Extract<RepoOpenResult, { ok: false }>

/**
 * ③ — 절대 경로만 통과시킨다.
 *
 * 왜 필요한가(실측): `spawn`의 `cwd`는 `''`·`'.'`·상대 경로를 **main 프로세스의 `process.cwd()`
 * 기준으로 해석한다** (실측: `cwd=''` → 아무 오류 없이 exit 0, stdout `"true"`). 그러면
 * `pnpm dev`에서 `''` 하나가 이 앱 자신의 소스 저장소를 연다. `repo.select()`는 OS 다이얼로그가
 * 절대 경로만 주므로 이 입력을 받을 수 없다 — **절대 경로성만은 select 쪽이 구조적으로 보장하고
 * open 쪽은 안 한다.** 이 인자는 디스크 settings.json에서 오고, `sanitizeSettings`는
 * `typeof === 'string'`만 보므로 `''`도 통과시킨다(실측).
 *
 * 권한 상승은 아니다 — 결과는 여전히 `--show-toplevel` 정규화를 거쳐 실재하는 저장소 루트만
 * allowlist에 든다. 그래도 "select()와 동일한 검증"이라는 계약서 문장이 참이 되게 닫는다.
 */
export function assertAbsoluteRepoPath(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}

/**
 * ④ — 폴더 확인이 실패한 원인을 "정말 없다"와 "모르겠다"로 가른다.
 *
 * 예전엔 `.catch(() => null)` 하나가 **모든** 실패를 "그 폴더는 이제 Git 저장소가 아니에요.
 * 목록에서 지울게요."로 뭉갰고, 항목이 실제로 지워졌다 — 마운트 안 된 외장 디스크, `EACCES`,
 * PATH에 git이 없는 경우까지. 멀쩡히 존재하는 저장소가 목록에서 사라지고, 되살리려면
 * 다이얼로그로 다시 열어야 했다.
 *
 * **왜 spawn 오류 코드로 가르지 않는가 (실측 — 이게 결정적이다):** 없는 디렉터리를 cwd로 준
 * spawn 실패와 PATH에 git이 없는 spawn 실패는 **구별이 불가능하다.** 둘 다
 * `code='ENOENT'`, `syscall='spawn git'`, `path='git'`, message `"spawn git ENOENT"`로 온다
 * (실측 — 바이트까지 같다). spawn 코드로 갈랐다면 **git이 안 깔린 머신에서 최근 목록이 통째로
 * 지워진다.** 그래서 spawn에 맡기지 않고 `fs.stat`으로 폴더를 직접 묻고, 그 오류만 가른다.
 *
 * ENOENT(없는 경로)·ENOTDIR(중간이 파일)만 '없다'다. 나머지(EACCES, 미마운트 볼륨의 오류,
 * 70,000자 경로의 ENAMETOOLONG 등)는 '모르겠다'로 남겨 **목록을 건드리지 않는다.**
 */
export function isMissingDirectoryError(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** 폴더가 정말 없다 — 목록에서 빼도 되는 확실한 경우 */
export function repoGone(): RepoOpenFailure {
  return {
    ok: false,
    reason: 'missing',
    message: '그 폴더가 없어요. 옮겼거나 지운 것 같아요 — 목록에서 지울게요.',
  }
}

/** 폴더는 있는데 Git 저장소가 아니다 — 이것도 확실하다 (bare repo·.git 폴더 포함) */
export function repoNotARepository(): RepoOpenFailure {
  return {
    ok: false,
    reason: 'not-a-repository',
    message: '그 폴더는 이제 Git 저장소가 아니에요. 목록에서 지울게요.',
  }
}

/**
 * 확인 자체를 못 했다 — 목록은 **그대로 둔다.**
 * 실제 원인 둘(디스크 미연결, git 미설치)을 둘 다 문구에 담는다. 예전 주석이 걱정하던
 * "git이 안 깔린 것처럼 읽힌다"는 이제 걱정이 아니라 **실제 가능성 중 하나**다.
 */
export function repoOpenUnchecked(cause: unknown): RepoOpenFailure {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return {
    ok: false,
    reason: 'failed',
    message: `그 폴더를 확인하지 못했어요 — 디스크가 연결돼 있는지, git이 설치돼 있는지 확인해 주세요. 목록은 그대로 둘게요. (${detail})`,
  }
}
