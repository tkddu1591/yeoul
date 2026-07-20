/** 원격 저장소 좌표 — host는 소문자로 정규화한다. owner/repo 표기는 원문 보존(표시용) */
export interface RemoteRepoRef {
  host: string
  owner: string
  repo: string
}

// https://github.com/o/r(.git) — 사용자 정보·포트 허용 (https://user@host:8443/o/r.git)
const HTTPS_PATTERN = /^https?:\/\/(?:[^/@]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
// ssh://git@github.com(:22)/o/r(.git)
const SSH_PATTERN = /^ssh:\/\/(?:[^/@]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
// scp형 — git@github.com:o/r(.git). 콜론 뒤가 경로다
const SCP_PATTERN = /^[^@/]+@([^:/]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/

/**
 * remote URL에서 { host, owner, repo }를 뽑는다 — GitHub 여부 판정은 호출자가 host로 한다.
 * 로컬 경로·bare 경로·이해할 수 없는 형태는 null (리뷰 기능이 조용히 꺼진다).
 */
export function parseRemoteUrl(url: string): RemoteRepoRef | null {
  for (const pattern of [HTTPS_PATTERN, SSH_PATTERN, SCP_PATTERN]) {
    const match = pattern.exec(url.trim())
    if (match !== null) {
      return { host: match[1]!.toLowerCase(), owner: match[2]!, repo: match[3]! }
    }
  }
  return null
}
