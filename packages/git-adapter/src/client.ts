import {
  detectState,
  type BranchCompare,
  type BranchOverview,
  type BranchSummary,
  type CherryPickResult,
  type CommitDetail,
  type CommitSummary,
  type DiffOptions,
  type FileDiff,
  type MergeResult,
  type PullResult,
  type RebaseContinueResult,
  type RebaseProgress,
  type RebaseResult,
  type RemoveBranchResult,
  type RepositoryStatus,
  type RestoreFileResult,
  type RevertResult,
  type ShelfEntry,
  type SwitchResult,
  type SyncBranchStatus,
} from '@git-gui/domain'
import { execGit, execGitOrThrow, GitError, type GitResult } from '@git-gui/git-process'
import { lstat, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseCommitMeta, parseNameStatus } from './commit-detail-parser'
import { parseLog } from './log-parser'
import { parsePatch } from './diff-parser'
import { readGitDirMarkers } from './markers'
import { parseOverview } from './overview-parser'
import { parseBranches, parseShelf } from './refs-parser'
import { parseStatusV2 } from './status-parser'

export type { DiffOptions } from '@git-gui/domain'

export interface GitClient {
  repo: {
    status(): Promise<RepositoryStatus>
  }
  branches: {
    /** 실험 공간 목록 — 마지막 저장 시점 최신순 */
    list(): Promise<BranchSummary[]>
    /** 패널용 일괄 개요 — 로컬(upstream·ahead/behind·gone)+원격, for-each-ref 1회 (E7a) */
    overview(): Promise<BranchOverview>
    /**
     * 선택 공간을 원격 최신으로(비현재 전용 — 현재 공간은 renderer가 받아오기(pull)로 보낸다).
     * fetch refspec은 ff-only가 기본(실측 3) — 갈라졌으면 이동해서 pull 하도록 친절 거부한다
     */
    update(name: string): Promise<void>
    /** 선택 공간을 checkout 없이 백업(push). upstream 없으면 -u로 연결하며 올린다 (origin 우선 관례) */
    backup(name: string): Promise<void>
    /** 원격 공간을 추적 로컬 브랜치로 가져와 이동한다. 동명 로컬이 있으면 거부, 겹치면 자동 보관 (switch 관례) */
    checkoutRemote(name: string): Promise<SwitchResult>
    /** 원격에서 이 공간을 지운다(push --delete) — 확인창은 UI 책임. 다른 사람에게도 영향이 있다 */
    removeRemote(name: string): Promise<void>
    /** 지금 공간과의 양방향 전용 저장 목록 — 각 100개 상한 + overflow (E7a) */
    compare(name: string): Promise<BranchCompare>
    /** 새 실험 공간 — fromHash가 있으면 그 시점에서, 없으면 지금(HEAD)에서. 만들기만 하고 전환하지 않는다 */
    create(name: string, fromHash: string | null): Promise<void>
    /**
     * 실험 공간 전환. 겹치지 않는 변경은 그대로 들고 간다(git 기본 동작).
     * 겹쳐서 막히면 스펙 원칙대로 변경을 보관함에 자동 저장하고 전환한다 —
     * 자동 복원은 하지 않는다(막힌 파일은 대상과 반드시 달라 복원이 거의 확실히 충돌한다).
     */
    switch(name: string): Promise<SwitchResult>
    /**
     * name 공간을 지금 공간으로 합친다(스마트 병합). 막히면 변경을 보관함에 자동 저장 후 재시도.
     * conflict면 충돌 상태를 남긴다 — 마무리는 commits.create(저장하기), 취소는 merge.abort.
     */
    merge(name: string): Promise<MergeResult>
    /** 실험 공간 지우기 — 합쳐지지 않은 저장이 있으면 needsForce로 알린다(확인창은 UI). 현재 공간은 거부 */
    remove(name: string, force: boolean): Promise<RemoveBranchResult>
    /** 이름 바꾸기 */
    rename(oldName: string, newName: string): Promise<void>
  }
  rebase: {
    /**
     * 현재 공간을 onto 위로 재배치. 작업 중 변경이 겹치면 자동 보관 후 재시도(merge 관례).
     * conflict면 rebasing 상태가 남는다 — 해소는 기존 충돌 카드, 진행은 continue, 취소는 abort
     */
    start(onto: string): Promise<RebaseResult>
    /**
     * 겹침을 모두 해소(add)한 뒤 다음 저장으로. 남은 저장이 또 겹치면 conflict.
     * 해소 결과가 빈 저장이면 git이 자동으로 건너뛴다(실측 2 — --skip 확인창 불필요)
     */
    continue(): Promise<RebaseContinueResult>
    /** 재배치 취소 — 시작 전 상태로 되돌린다 */
    abort(): Promise<void>
    /** 진행 위치(.git/rebase-merge/msgnum·end — 실측 2). rebasing이 아니면 null */
    progress(): Promise<RebaseProgress | null>
  }
  merge: {
    /** 합치기 취소 — 충돌 상태를 버리고 합치기 전으로 되돌린다 */
    abort(): Promise<void>
  }
  conflicts: {
    /** 충돌 파일을 한쪽으로 확정한다 — ours=내 것 유지, theirs=가져온 것 사용. 해소(staged)로 표시된다 */
    resolve(path: string, choice: 'ours' | 'theirs'): Promise<void>
    /** 직접 수정을 마쳤다고 표시한다(git add) — 마커가 남았는지는 UI가 확인창으로 경고한다 */
    markResolved(path: string): Promise<void>
    /**
     * 충돌 파일의 워크트리 내용을 통째로 바꾼다(블록 선택·자세히 보기 저장) — add하지 않는다.
     * 확정은 markResolved가 담당한다. 비충돌 파일은 resolve와 동일 문구로 거부한다(조용한 유실 차단)
     */
    saveText(path: string, content: string): Promise<void>
    /** 처음부터 다시 — 부분 해소를 버리고 겹침 표시를 되살린다(git checkout -m). index는 UU 그대로다 */
    reset(path: string): Promise<void>
  }
  files: {
    /** 워크트리 텍스트 파일 읽기(충돌 뷰용) — 1MB 상한, 바이너리 거부 */
    readText(path: string): Promise<string>
  }
  shelf: {
    /** 지금 변경(미추적 포함)을 보관함에 저장한다. 변경이 없으면 거부 */
    save(message: string): Promise<void>
    /** 보관함 목록 — 최신이 stash@{0} */
    list(): Promise<ShelfEntry[]>
    /** 꺼내기(pop) — 겹치면 충돌 표시로 적용되고 항목은 보관함에 남는다(에러로 알린다) */
    restore(ref: string): Promise<void>
    /** 버리기 — 되돌릴 수 없다 (확인창은 renderer 책임) */
    drop(ref: string): Promise<void>
  }
  changes: {
    stage(paths: string[]): Promise<void>
    unstage(paths: string[]): Promise<void>
    /**
     * 선택 파일의 아직 올리지 않은(unstaged) 변경 취소 — tracked는 index 상태로 복원(staged 보존),
     * untracked는 삭제. 되돌릴 수 없다. 경로는 파일 단위여야 한다(-uall status가 공급) —
     * 디렉터리 pathspec을 주면 clean이 그 아래 미추적 전체를 지운다(실측).
     */
    discard(trackedPaths: string[], untrackedPaths: string[]): Promise<void>
    diff(path: string, options: DiffOptions): Promise<FileDiff>
    /**
     * 파일 하나를 디스크에서 삭제한다 — tracked는 status가 삭제 변경으로 잡고 untracked는 그대로 사라진다.
     * 되돌릴 수 없다(확인창은 UI 책임). 부재 파일·디렉터리·심볼릭 링크·충돌 파일은 친절 에러로 거부
     */
    removeFile(path: string): Promise<void>
  }
  history: {
    /** 최신순 커밋 요약. limit은 1~10000으로 잘린다 */
    list(limit: number): Promise<CommitSummary[]>
  }
  sync: {
    /** 현재 브랜치를 원격으로 백업한다. upstream이 없으면 첫 remote에 연결하며 올린다 */
    push(): Promise<void>
    /**
     * 원격의 최신 저장을 받아온다(fetch+merge). 막히면 자동 보관 후 재시도.
     * conflict면 MERGE_HEAD가 남아 기존 합치기 충돌 흐름(머지 바·충돌 뷰·저장하기 마무리)을 그대로 쓴다.
     */
    pull(): Promise<PullResult>
    /** 현재 브랜치 이름과 upstream 유무 — 리뷰 요청(PR) 전 검사용. detached면 branch null */
    branchStatus(): Promise<SyncBranchStatus>
    /** 백업 대상 remote(origin 우선 — push와 동일 규칙)의 URL. remote가 없으면 null */
    remoteUrl(): Promise<string | null>
  }
  commits: {
    create(message: string): Promise<void>
    /** 커밋 상세 — 전체 메시지·변경 파일. 병합 커밋은 첫 부모 기준 */
    show(hash: string): Promise<CommitDetail>
    /** 커밋 안 단일 파일의 diff — 첫 부모 기준. rename이면 origPath를 함께 넘긴다 */
    diffFile(hash: string, path: string, origPath: string | null): Promise<FileDiff>
    /**
     * 이 파일만 그 시점(hash) 내용으로 적용한다(checkout — index·워크트리 동시 갱신, 실측).
     * 파일에 미저장 변경이 있으면 먼저 파일 단위로 보관함에 자동 보관한다(§6 — staged-only도 담긴다, 실측).
     * 보관함 항목의 커밋 해시로도 동작한다(파일 단위 꺼내기). 충돌 파일·그 시점에 없는 파일은 거부
     */
    restoreFile(hash: string, path: string): Promise<RestoreFileResult>
    /** 그 시점(hash)과 지금 워크트리(미저장 포함)의 단일 파일 diff — diffFile(부모 대비)의 형제. rename이면 origPath 동봉 */
    diffAgainstWorktree(hash: string, path: string, origPath: string | null): Promise<FileDiff>
    /** 이 저장이 바꾼 내용을 반대로 적용하는 새 저장을 만든다. merge commit은 첫 부모 기준(-m 1) */
    revert(hash: string): Promise<RevertResult>
    /** 되돌리기 취소 — 충돌 상태를 버리고 이전으로 */
    revertAbort(): Promise<void>
    /**
     * 이 저장 하나만 지금 공간으로 가져오는 새 저장을 만든다(cherry-pick) — revert와 동일 골격.
     * merge commit은 친절 거부(-m 재시도 없음 — "이 저장만"의 의미가 병합 전체와 어긋난다).
     * 이미 반영된 저장은 빈 진행 상태를 정리하고 empty로 알린다. dirty 겹침은 자동 보관 후 재시도
     */
    cherryPick(hash: string): Promise<CherryPickResult>
    /** 가져오기 취소 — 충돌 상태를 버리고 이전으로 */
    cherryPickAbort(): Promise<void>
    /** 이 시점에 태그(lightweight)를 만든다 — 이름은 check-ref-format 선검증, 중복은 친절 에러 */
    createTag(name: string, hash: string): Promise<void>
    /**
     * 마지막 저장 실행취소(reset --mixed HEAD~1) — 내용은 작업 폴더에 남는다(실측 8, 유실 없음).
     * hash는 화면이 아는 HEAD — 실제 HEAD와 다르면(낡은 목록) 거부한다. 루트 커밋·진행 중 상태 거부
     */
    undoLast(hash: string): Promise<void>
    /**
     * 마지막 저장의 메시지를 바꾼다(commit --amend -F -, 메시지만 — 실측 7: tree 불변).
     * staged가 있으면 amend가 조용히 흡수하므로 거부. hash는 undoLast와 동일한 HEAD 일치 가드
     */
    reword(hash: string, message: string): Promise<void>
  }
}

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null'

/**
 * pathspec 매직(':(top)' 등)과 글롭('*')이 해석되지 않도록 리터럴로 고정한다.
 * 빈 배열은 pathspec 없는 전체 작업(add -A --)으로 전락하므로 명시적으로 거부한다 —
 * staged-only 내용이 워크트리 내용으로 덮어써지는 유실 경로다.
 */
function toPathspecs(paths: string[]): string[] {
  // 빈 문자열 요소도 ':(literal)' + '' = match-all pathspec으로 전락한다 — 함께 거부
  if (paths.length === 0 || paths.some((path) => path === '')) {
    throw new Error('빈 경로 — 전체 작업으로 확대되는 것을 막기 위해 거부한다')
  }
  return paths.map((path) => `:(literal)${path}`)
}

/** 저장소 루트 상대 경로만 허용한다 — 빈 경로, 절대 경로, 상위 탈출(..)을 거부한다 */
function assertRepoRelative(path: string): void {
  if (path === '' || path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error(`저장소 밖 경로는 다룰 수 없다: ${path}`)
  }
}

/** renderer가 넘긴 해시는 40자 hex 전체 해시만 신뢰한다 — ref 표현식(HEAD~ 등)·옵션 밀수를 차단 */
function assertFullHash(hash: string): void {
  if (!/^[0-9a-f]{40}$/.test(hash)) {
    throw new Error(`올바른 커밋 해시가 아니에요: ${hash}`)
  }
}

/** CLI에서 rebase/gc로 사라진 커밋을 오래된 목록에서 클릭하는 흐름 — 원시 git 에러 대신 이 문구로 */
const MISSING_COMMIT_MESSAGE = '그 저장 시점을 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.'

/** 전환이 막혀 자동 보관할 때의 보관함 메시지 — UI·테스트가 이 문구로 항목을 식별한다 */
const AUTO_SHELF_MESSAGE = '실험 공간 전환 자동 보관'

/** 합치기가 막혀 자동 보관할 때의 보관함 메시지 */
const MERGE_SHELF_MESSAGE = '실험 공간 합치기 자동 보관'

/** 받아오기가 막혀 자동 보관할 때의 보관함 메시지 */
const PULL_SHELF_MESSAGE = '받아오기 자동 보관'

/** 되돌리기가 막혀 자동 보관할 때의 보관함 메시지 */
const REVERT_SHELF_MESSAGE = '저장 되돌리기 자동 보관'

/** 파일 단위 적용이 미저장 변경을 덮기 전 자동 보관할 때의 보관함 메시지 */
const RESTORE_FILE_SHELF_MESSAGE = '파일 적용 자동 보관'

/** 가져오기(cherry-pick)가 막혀 자동 보관할 때의 보관함 메시지 */
const CHERRY_PICK_SHELF_MESSAGE = '저장 가져오기 자동 보관'

/** 재배치가 막혀 자동 보관할 때의 보관함 메시지 (E7a) */
const REBASE_SHELF_MESSAGE = '저장 재배치 자동 보관'

/** "지금과 비교" 한 방향 상한 — 초과분은 overflow 플래그로만 알린다 (E7a) */
const COMPARE_LIMIT = 100

/**
 * 원격이 앞서 거부된 push (E5b 후속·E6b 실측) — stderr 4케이스 전부 "! [rejected] …
 * (fetch first|non-fast-forward)". undo(실행취소)로 로컬이 뒤로 간 경우도 같은
 * non-fast-forward 거부라 같은 문구로 커버된다. 'failed to push some refs'는 hook
 * 거부([remote rejected])에도 나와 쓰지 않는다 — 괄호 사유로만 판정한다.
 * E7a에서 브랜치별 백업(branches.backup)과 공유하려고 sync.push 안에서 모듈로 올렸다
 */
function rejectIfRemoteAhead(result: GitResult): void {
  if (
    result.stderr.includes('(fetch first)') ||
    result.stderr.includes('(non-fast-forward)')
  ) {
    throw new Error('원격에 새 저장이 있어요. 먼저 받아오기(pull)로 합친 뒤 백업해 주세요.')
  }
}

/** stash ref 형식만 통과 — 임의 revision 표현식이 stash 명령으로 흘러가는 것을 차단 */
function assertShelfRef(ref: string): void {
  if (!/^stash@\{\d{1,6}\}$/.test(ref)) {
    throw new Error(`올바른 보관함 항목이 아니에요: ${ref}`)
  }
}

export function createGitClient(repoPath: string): GitClient {
  // porcelain 출력 경로는 루트 상대, pathspec은 cwd 상대다 —
  // 하위 폴더로 열려도 어긋나지 않도록 cwd를 저장소 루트로 정규화한다.
  let topLevelPromise: Promise<string> | null = null
  const topLevel = (): Promise<string> => {
    topLevelPromise ??= execGitOrThrow(['rev-parse', '--show-toplevel'], { cwd: repoPath }).then(
      (result) => result.stdout.trim(),
    )
    return topLevelPromise
  }

  return {
    repo: {
      async status() {
        const cwd = await topLevel()
        // -uall: 미추적 디렉터리를 접지 않고 파일 단위로 나열한다 — 접힌 `dir/` 행은
        // 이름 없는 행·diff 에러·stage/unstage 왕복 시 경로 정체성 문제를 만든다.
        // (알려진 한계: 거대한 미추적 트리는 행이 폭발한다 — E0-3b 가상화에서 흡수)
        const raw = await execGitOrThrow(['status', '--porcelain=v2', '--branch', '-uall', '-z'], { cwd })
        const parsed = parseStatusV2(raw.stdout)
        const gitDir = (
          await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })
        ).stdout.trim()
        const markers = await readGitDirMarkers(gitDir)
        return {
          state: detectState(markers),
          branch: parsed.branch,
          headHash: parsed.headHash,
          changes: parsed.changes,
        }
      },
    },
    branches: {
      async list() {
        const cwd = await topLevel()
        const raw = await execGitOrThrow(
          [
            'for-each-ref',
            'refs/heads',
            '--sort=-committerdate',
            '--format=%(refname:short)\x1f%(HEAD)\x1f%(committerdate:unix)\x1f%(upstream:short)',
          ],
          { cwd },
        )
        return parseBranches(raw.stdout)
      },
      async overview() {
        const cwd = await topLevel()
        // %1f = US 구분자, symref = origin/HEAD 판별, refname 전체 경로 = heads/remotes 분류 (실측 1)
        const raw = await execGitOrThrow(
          [
            'for-each-ref',
            'refs/heads',
            'refs/remotes',
            '--sort=-committerdate',
            '--format=%(refname)%1f%(refname:short)%1f%(symref)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)%1f%(objectname)',
          ],
          { cwd },
        )
        const head = await execGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd })
        return parseOverview(raw.stdout, head.exitCode === 0 ? head.stdout.trim() : null)
      },
      async update(name) {
        const cwd = await topLevel()
        const remote = await execGit(['config', '--get', `branch.${name}.remote`], { cwd })
        const mergeRef = await execGit(['config', '--get', `branch.${name}.merge`], { cwd })
        if (remote.exitCode !== 0 || mergeRef.exitCode !== 0) {
          throw new Error('원격과 연결된 적이 없는 공간이에요. 그 공간으로 이동해 백업(push)하면 연결돼요.')
        }
        const remoteName = remote.stdout.trim()
        const srcBranch = mergeRef.stdout.trim().replace(/^refs\/heads\//, '')
        // ff-only가 fetch refspec의 기본 동작이다(강제 없음) — 갈라졌으면 rejected로 끝난다 (실측 3)
        const args = ['fetch', '--end-of-options', remoteName, `${srcBranch}:${name}`]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('(non-fast-forward)')) {
            throw new Error(
              '이 공간은 원격과 갈라져 있어요. 그 공간으로 이동한 뒤 받아오기(pull)로 합쳐 주세요.',
            )
          }
          // 현재 공간(다른 워크트리 포함) — refspec fetch가 체크아웃된 브랜치를 거부한다 (실측 3)
          if (result.stderr.includes('refusing to fetch into branch')) {
            throw new Error('지금 체크아웃되어 있는 공간이에요. 받아오기(pull)로 업데이트해 주세요.')
          }
          if (result.stderr.includes("couldn't find remote ref")) {
            throw new Error('원격에 이 공간이 더 이상 없어요. 새로고침해 주세요.')
          }
          throw new GitError(args, result)
        }
      },
      async backup(name) {
        const cwd = await topLevel()
        const remoteConfig = await execGit(['config', '--get', `branch.${name}.remote`], { cwd })
        const mergeRef = await execGit(['config', '--get', `branch.${name}.merge`], { cwd })
        if (remoteConfig.exitCode !== 0 || mergeRef.exitCode !== 0) {
          // upstream 없음(또는 반쪽 연결 — remote만 있고 merge 없음, 품질 리뷰 보완) —
          // sync.push의 origin 우선 관례로 첫 연결하며 올린다(반쪽 연결도 이 경로가 수리한다)
          const remotes = await execGitOrThrow(['remote'], { cwd })
          const remoteNames = remotes.stdout
            .trim()
            .split('\n')
            .filter((n) => n !== '')
          if (remoteNames.length === 0) {
            throw new Error('백업할 원격 저장소가 없어요. 먼저 원격 저장소를 연결해 주세요.')
          }
          const target = remoteNames.includes('origin') ? 'origin' : remoteNames[0]!
          const args = ['push', '-u', '--end-of-options', target, name]
          const linked = await execGit(args, { cwd })
          if (linked.exitCode !== 0) {
            rejectIfRemoteAhead(linked)
            throw new GitError(args, linked)
          }
          return
        }
        const remoteName = remoteConfig.stdout.trim()
        const dstBranch = mergeRef.stdout.trim().replace(/^refs\/heads\//, '')
        const args = ['push', '--end-of-options', remoteName, `${name}:${dstBranch}`]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          rejectIfRemoteAhead(result)
          throw new GitError(args, result)
        }
      },
      async checkoutRemote(name) {
        const cwd = await topLevel()
        const slash = name.indexOf('/')
        if (slash <= 0) throw new Error(`"${name}"는 원격 공간 이름이 아니에요.`)
        const local = name.slice(slash + 1)
        // 동명 로컬 선검사 — switch -c의 원어 fatal(실측 4) 대신 행동 안내를 준다
        const existing = await execGit(['rev-parse', '-q', '--verify', `refs/heads/${local}`], {
          cwd,
        })
        if (existing.exitCode === 0) {
          throw new Error(
            `이미 "${local}" 공간이 있어요. 그 공간으로 이동해 "원격 최신으로 업데이트"해 주세요.`,
          )
        }
        const args = ['switch', '-c', local, '--track', '--end-of-options', name]
        const first = await execGit(args, { cwd })
        if (first.exitCode === 0) return { autoShelved: false }
        if (!first.stderr.includes('would be overwritten')) throw new GitError(args, first)
        // 겹쳐서 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 진행한다 (switch 관례)
        await execGitOrThrow(['stash', 'push', '-u', '-m', AUTO_SHELF_MESSAGE], { cwd })
        await execGitOrThrow(args, { cwd })
        return { autoShelved: true }
      },
      async removeRemote(name) {
        const cwd = await topLevel()
        const slash = name.indexOf('/')
        if (slash <= 0) throw new Error(`"${name}"는 원격 공간 이름이 아니에요.`)
        const remoteName = name.slice(0, slash)
        const branch = name.slice(slash + 1)
        const args = ['push', '--delete', '--end-of-options', remoteName, branch]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('remote ref does not exist')) {
            throw new Error('원격에 이 공간이 이미 없어요. 새로고침해 주세요.')
          }
          throw new GitError(args, result)
        }
      },
      async compare(name) {
        const cwd = await topLevel()
        // 같은 이름의 태그가 있으면 bare 이름이 태그로 풀린다(gitrevisions 우선순위 — 품질 리뷰) —
        // 로컬 브랜치가 있으면 refs/heads/를 우선하고, 아니면(원격 ref 등) 이름 그대로 쓴다
        const asLocal = await execGit(['rev-parse', '-q', '--verify', `refs/heads/${name}`], { cwd })
        const ref = asLocal.exitCode === 0 ? `refs/heads/${name}` : name
        const valid = await execGit(['rev-parse', '-q', '--verify', `${ref}^{commit}`], { cwd })
        if (valid.exitCode !== 0) {
          throw new Error(`"${name}"라는 공간을 찾을 수 없어요. 새로고침해 주세요.`)
        }
        // history.list와 같은 레코드 포맷 — parseLog를 그대로 재사용한다
        const listSide = async (range: string) => {
          const raw = await execGitOrThrow(
            [
              'log',
              '--format=%H%x1f%h%x1f%an%x1f%ct%x1f%D%x1f%P%x1f%s',
              '-z',
              '-n',
              String(COMPARE_LIMIT + 1),
              range,
            ],
            { cwd },
          )
          const commits = parseLog(raw.stdout)
          return {
            commits: commits.slice(0, COMPARE_LIMIT),
            overflow: commits.length > COMPARE_LIMIT,
          }
        }
        const selectedOnly = await listSide(`HEAD..${ref}`)
        const currentOnly = await listSide(`${ref}..HEAD`)
        return {
          onlyInSelected: selectedOnly.commits,
          selectedOverflow: selectedOnly.overflow,
          onlyInCurrent: currentOnly.commits,
          currentOverflow: currentOnly.overflow,
        }
      },
      async create(name, fromHash) {
        const cwd = await topLevel()
        const valid = await execGit(['check-ref-format', '--branch', name], { cwd })
        if (valid.exitCode !== 0) {
          throw new Error(`"${name}"라는 이름으로는 만들 수 없어요. 공백 없이 지어 주세요.`)
        }
        if (fromHash !== null) assertFullHash(fromHash)
        const args =
          fromHash !== null
            ? ['branch', '--end-of-options', name, fromHash]
            : ['branch', '--end-of-options', name]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('already exists')) {
            throw new Error(`"${name}"는 이미 있는 이름이에요. 다른 이름을 지어 주세요.`)
          }
          throw new GitError(args, result)
        }
      },
      async switch(name) {
        const cwd = await topLevel()
        // 먼저 그대로 시도한다 — 겹치지 않는 변경은 git이 자연스럽게 들고 간다
        const first = await execGit(['switch', '--end-of-options', name], { cwd })
        if (first.exitCode === 0) return { autoShelved: false }
        if (first.stderr.includes('invalid reference')) {
          throw new Error(`"${name}"라는 실험 공간이 없어요.`)
        }
        if (
          first.stderr.includes('resolve your current index') ||
          first.stderr.includes('cannot switch branch while')
        ) {
          throw new Error('충돌 정리(!)를 먼저 끝내야 다른 실험 공간으로 이동할 수 있어요.')
        }
        if (!first.stderr.includes('would be overwritten')) {
          throw new GitError(['switch', '--end-of-options', name], first)
        }
        // 겹쳐서 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 진행한다
        await execGitOrThrow(['stash', 'push', '-u', '-m', AUTO_SHELF_MESSAGE], { cwd })
        await execGitOrThrow(['switch', '--end-of-options', name], { cwd })
        return { autoShelved: true }
      },
      async merge(name) {
        const cwd = await topLevel()
        const classify = (output: string): MergeResult['outcome'] => {
          if (output.includes('Already up to date')) return 'up-to-date'
          if (output.includes('Fast-forward')) return 'fast-forward'
          return 'merged'
        }
        const run = () => execGit(['merge', '--no-edit', '--end-of-options', name], { cwd })
        const first = await run()
        const firstOut = first.stdout + first.stderr
        if (first.exitCode === 0) return { outcome: classify(firstOut), autoShelved: false }
        if (firstOut.includes('not something we can merge')) {
          throw new Error(`"${name}"라는 실험 공간이 없어요.`)
        }
        if (firstOut.includes('CONFLICT') || firstOut.includes('Automatic merge failed')) {
          return { outcome: 'conflict', autoShelved: false }
        }
        if (!firstOut.includes('would be overwritten')) {
          throw new GitError(['merge', '--no-edit', '--end-of-options', name], first)
        }
        // 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 진행한다 (E1a switch와 동일 패턴)
        await execGitOrThrow(['stash', 'push', '-u', '-m', MERGE_SHELF_MESSAGE], { cwd })
        const second = await run()
        const secondOut = second.stdout + second.stderr
        if (second.exitCode === 0) return { outcome: classify(secondOut), autoShelved: true }
        if (secondOut.includes('CONFLICT') || secondOut.includes('Automatic merge failed')) {
          return { outcome: 'conflict', autoShelved: true }
        }
        throw new GitError(['merge', '--no-edit', '--end-of-options', name], second)
      },
      async remove(name, force) {
        const cwd = await topLevel()
        const args = ['branch', force ? '-D' : '-d', '--end-of-options', name]
        const result = await execGit(args, { cwd })
        if (result.exitCode === 0) return { removed: true, needsForce: false }
        if (result.stderr.includes('not fully merged')) {
          return { removed: false, needsForce: true }
        }
        if (result.stderr.includes('used by worktree')) {
          throw new Error('지금 있는 실험 공간은 지울 수 없어요. 다른 공간으로 이동한 뒤 지워 주세요.')
        }
        if (result.stderr.includes('not found')) {
          throw new Error(`"${name}"라는 실험 공간이 없어요.`)
        }
        throw new GitError(args, result)
      },
      async rename(oldName, newName) {
        const cwd = await topLevel()
        const valid = await execGit(['check-ref-format', '--branch', newName], { cwd })
        if (valid.exitCode !== 0) {
          throw new Error(`"${newName}"라는 이름으로는 만들 수 없어요. 공백 없이 지어 주세요.`)
        }
        const args = ['branch', '-m', '--end-of-options', oldName, newName]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('already exists')) {
            throw new Error(`"${newName}"는 이미 있는 이름이에요. 다른 이름을 지어 주세요.`)
          }
          throw new GitError(args, result)
        }
      },
    },
    rebase: {
      async start(onto) {
        const cwd = await topLevel()
        const classify = (result: GitResult): RebaseResult['outcome'] | null => {
          const output = result.stdout + result.stderr
          if (result.exitCode === 0) {
            return output.includes('is up to date') ? 'up-to-date' : 'completed'
          }
          if (output.includes('Could not apply') || output.includes('CONFLICT')) return 'conflict'
          return null
        }
        const args = ['rebase', '--end-of-options', onto]
        const first = await execGit(args, { cwd })
        const firstOutcome = classify(first)
        if (firstOutcome !== null) return { outcome: firstOutcome, autoShelved: false }
        const firstOut = first.stdout + first.stderr
        if (firstOut.includes('invalid upstream')) {
          throw new Error(`"${onto}"라는 실험 공간이 없어요.`)
        }
        if (
          !firstOut.includes('You have unstaged changes') &&
          !firstOut.includes('Please commit or stash')
        ) {
          throw new GitError(args, first)
        }
        // 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 재시도한다 (merge 관례, 실측 2 dirty 판정)
        await execGitOrThrow(['stash', 'push', '-u', '-m', REBASE_SHELF_MESSAGE], { cwd })
        const second = await execGit(args, { cwd })
        const secondOutcome = classify(second)
        if (secondOutcome !== null) return { outcome: secondOutcome, autoShelved: true }
        throw new GitError(args, second)
      },
      async continue() {
        const cwd = await topLevel()
        // 원 메시지를 그대로 쓴다 — 편집기가 열리면 앱이 멈추므로 방어적으로 무시한다
        const args = ['-c', 'core.editor=true', 'rebase', '--continue']
        const result = await execGit(args, { cwd })
        if (result.exitCode === 0) return { outcome: 'completed' as const }
        const output = result.stdout + result.stderr
        if (output.includes('Could not apply') || output.includes('CONFLICT')) {
          return { outcome: 'conflict' as const }
        }
        if (output.includes('needs merge') || output.includes('You must edit all merge conflicts')) {
          throw new Error('아직 겹침이 남아 있어요. 붉은 ! 파일을 모두 해결한 뒤 계속해 주세요.')
        }
        if (output.includes('no rebase in progress')) {
          throw new Error('지금은 재배치 중이 아니에요.')
        }
        throw new GitError(args, result)
      },
      async abort() {
        const cwd = await topLevel()
        const result = await execGit(['rebase', '--abort'], { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('no rebase in progress')) {
            throw new Error('지금은 재배치 중이 아니에요.')
          }
          throw new GitError(['rebase', '--abort'], result)
        }
      },
      async progress() {
        const cwd = await topLevel()
        const gitDir = (
          await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })
        ).stdout.trim()
        // merge 백엔드(이 앱이 시작하는 rebase의 기본)의 진행 파일 — msgnum=현재, end=전체 (실측 2).
        // 파일이 없으면(외부 apply 백엔드 등) 진행 표시를 생략한다 — 추측하지 않는다
        try {
          const [current, total] = await Promise.all([
            readFile(join(gitDir, 'rebase-merge', 'msgnum'), 'utf8'),
            readFile(join(gitDir, 'rebase-merge', 'end'), 'utf8'),
          ])
          const parsed = { current: Number(current.trim()), total: Number(total.trim()) }
          if (!Number.isFinite(parsed.current) || !Number.isFinite(parsed.total)) return null
          return parsed
        } catch {
          return null
        }
      },
    },
    merge: {
      async abort() {
        const cwd = await topLevel()
        const result = await execGit(['merge', '--abort'], { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('MERGE_HEAD')) {
            throw new Error('지금은 합치는 중이 아니에요.')
          }
          throw new GitError(['merge', '--abort'], result)
        }
      },
    },
    conflicts: {
      async resolve(path, choice) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        // checkout --ours/--theirs는 충돌이 아닌 파일에서도 조용히 성공하며(exit 0, 실측)
        // 워크트리의 미저장 편집을 index 버전으로 덮어쓴다 — 충돌(unmerged) 파일만 통과시킨다
        const unmerged = await execGitOrThrow(['ls-files', '-u', '--', `:(literal)${path}`], { cwd })
        if (unmerged.stdout.trim() === '') {
          throw new Error('지금은 겹침(충돌) 상태가 아닌 파일이에요. 새로고침 후 다시 확인해 주세요.')
        }
        const side = choice === 'ours' ? '--ours' : '--theirs'
        await execGitOrThrow(['checkout', side, '--', `:(literal)${path}`], { cwd })
        await execGitOrThrow(['add', '--', `:(literal)${path}`], { cwd })
      },
      async markResolved(path) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        await execGitOrThrow(['add', '--', `:(literal)${path}`], { cwd })
      },
      async saveText(path, content) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        // resolve와 동일 가드·동일 문구 — 비충돌 파일 쓰기는 미저장 편집의 조용한 유실 경로다
        const unmerged = await execGitOrThrow(['ls-files', '-u', '--', `:(literal)${path}`], { cwd })
        if (unmerged.stdout.trim() === '') {
          throw new Error('지금은 겹침(충돌) 상태가 아닌 파일이에요. 새로고침 후 다시 확인해 주세요.')
        }
        // readText와 대칭 상한 — 이보다 큰 파일은 애초에 뷰로 열리지 않는다 (심층 방어)
        if (Buffer.byteLength(content, 'utf8') > 1_000_000) {
          throw new Error('파일이 너무 커요. 외부 편집기로 열어 주세요.')
        }
        const filePath = join(cwd, path)
        // 심볼릭 링크는 저장소 밖에 쓸 수 있다 — readText와 동일하게 거부.
        // 파일이 없으면(삭제형 충돌) 새로 만드는 것이 맞으니 lstat 실패는 통과시킨다
        const stats = await lstat(filePath).catch(() => null)
        if (stats !== null && stats.isSymbolicLink()) {
          throw new Error('링크 파일이라 내용을 저장할 수 없어요.')
        }
        await writeFile(filePath, content, 'utf8')
      },
      async reset(path) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        const unmerged = await execGitOrThrow(['ls-files', '-u', '--', `:(literal)${path}`], { cwd })
        if (unmerged.stdout.trim() === '') {
          throw new Error('지금은 겹침(충돌) 상태가 아닌 파일이에요. 새로고침 후 다시 확인해 주세요.')
        }
        // 실측: 부분 해소(일부 블록만 고쳐 쓴) 상태에서도 exit 0으로 전체 마커를 재생성한다.
        // 라벨은 브랜치명 대신 ours/theirs로 바뀌지만 파서는 접두사 기반이라 무관. index는 UU 유지
        await execGitOrThrow(['checkout', '-m', '--', `:(literal)${path}`], { cwd })
      },
    },
    files: {
      async readText(path) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        const filePath = join(cwd, path)
        // 심볼릭 링크는 저장소 밖을 가리킬 수 있다(실측 — 문자열 검증으로는 못 막는다). 링크는 거부한다
        const stats = await lstat(filePath)
        if (stats.isSymbolicLink()) {
          throw new Error('링크 파일이라 내용을 보여드릴 수 없어요.')
        }
        const buffer = await readFile(filePath)
        if (buffer.byteLength > 1_000_000) {
          throw new Error('파일이 너무 커요. 외부 편집기로 열어 주세요.')
        }
        if (buffer.includes(0)) {
          throw new Error('텍스트가 아닌 파일이라 내용을 보여드릴 수 없어요.')
        }
        return buffer.toString('utf8')
      },
    },
    shelf: {
      async save(message) {
        const cwd = await topLevel()
        const result = await execGit(['stash', 'push', '-u', '-m', message], { cwd })
        if (result.exitCode !== 0) {
          // 충돌(unmerged) 중에는 stash가 index를 쓸 수 없다 — 원어 대신 다음 행동을 안내한다 (통합 리뷰 실측)
          if (result.stderr.includes('could not write index')) {
            throw new Error('겹침(!)을 먼저 정리해야 보관할 수 있어요.')
          }
          throw new GitError(['stash', 'push', '-u', '-m', message], result)
        }
        if (result.stdout.includes('No local changes to save')) {
          throw new Error('보관할 변경이 없어요.')
        }
      },
      async list() {
        const cwd = await topLevel()
        const raw = await execGitOrThrow(['stash', 'list', '--format=%gd%x1f%ct%x1f%H%x1f%gs'], { cwd })
        return parseShelf(raw.stdout)
      },
      async restore(ref) {
        const cwd = await topLevel()
        assertShelfRef(ref)
        const result = await execGit(['stash', 'pop', ref], { cwd })
        if (result.exitCode !== 0) {
          // 겹침 — git이 충돌 표시로 적용하고 항목을 보관함에 남긴다 (유실 없음)
          if ((result.stdout + result.stderr).includes('kept in case you need it again')) {
            throw new Error(
              '겹치는 부분이 있어 충돌 표시(!)로 남겨뒀어요. 항목은 보관함에도 그대로 있어요.',
            )
          }
          throw new GitError(['stash', 'pop', ref], result)
        }
      },
      async drop(ref) {
        const cwd = await topLevel()
        assertShelfRef(ref)
        await execGitOrThrow(['stash', 'drop', ref], { cwd })
      },
    },
    changes: {
      async stage(paths) {
        const cwd = await topLevel()
        await execGitOrThrow(['add', '-A', '--', ...toPathspecs(paths)], { cwd })
      },
      async unstage(paths) {
        const cwd = await topLevel()
        await execGitOrThrow(['restore', '--staged', '--', ...toPathspecs(paths)], { cwd })
      },
      async discard(trackedPaths, untrackedPaths) {
        if (trackedPaths.length === 0 && untrackedPaths.length === 0) {
          throw new Error('빈 경로 — 전체 작업으로 확대되는 것을 막기 위해 거부한다')
        }
        const cwd = await topLevel()
        // restore는 untracked에 pathspec 불일치 에러를 내므로 tracked/untracked를 나눠 실행한다
        if (trackedPaths.length > 0) {
          const restoreArgs = ['restore', '--', ...toPathspecs(trackedPaths)]
          const result = await execGit(restoreArgs, { cwd })
          if (result.exitCode !== 0) {
            // 충돌 중인 파일은 restore가 거부한다 — 원어 에러 대신 다음 행동을 안내한다 (E1a 이관)
            if (result.stderr.includes('is unmerged')) {
              throw new Error(
                '충돌 중인 파일은 변경 취소로 정리할 수 없어요. 충돌 화면에서 한쪽을 고르거나 병합을 취소해 주세요.',
              )
            }
            throw new GitError(restoreArgs, result)
          }
        }
        if (untrackedPaths.length > 0) {
          await execGitOrThrow(['clean', '-f', '--', ...toPathspecs(untrackedPaths)], { cwd })
        }
      },
      async removeFile(path) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        // 충돌(unmerged) 파일 가드 — 삭제는 충돌 정리 흐름을 우회한다 (discard 가드와 동일 계열)
        const unmerged = await execGitOrThrow(['ls-files', '-u', '--', `:(literal)${path}`], { cwd })
        if (unmerged.stdout.trim() !== '') {
          throw new Error(
            '충돌 중인 파일은 삭제로 정리할 수 없어요. 충돌 화면에서 한쪽을 고르거나 병합을 취소해 주세요.',
          )
        }
        const filePath = join(cwd, path)
        const stats = await lstat(filePath).catch(() => null)
        if (stats === null) {
          throw new Error('이미 없는 파일이에요. 새로고침 후 다시 확인해 주세요.')
        }
        // 심볼릭 링크는 저장소 밖을 가리킬 수 있다 — readText·saveText와 동일 계열로 거부한다
        if (stats.isSymbolicLink()) {
          throw new Error('링크 파일이라 여기서는 지울 수 없어요.')
        }
        if (stats.isDirectory()) {
          throw new Error('폴더는 여기서 지울 수 없어요. 파일만 지울 수 있어요.')
        }
        await rm(filePath)
      },
      async diff(path, options) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        if (options.untracked) {
          // --no-index는 차이가 있으면 exit 1이 정상이지만 접근 실패도 exit 1이다 —
          // stdout 유무로 진짜 diff와 에러를 구분한다 (빈 결과로 위장하지 않는다)
          const args = [
            'diff',
            '--no-color',
            '--no-ext-diff',
            '--no-index',
            '--',
            NULL_DEVICE,
            path,
          ]
          const result = await execGit(args, { cwd })
          if (
            result.exitCode > 1 ||
            (result.exitCode === 1 && result.stdout === '' && result.stderr !== '')
          ) {
            throw new GitError(args, result)
          }
          return parsePatch(result.stdout)
        }
        const pathspecs = [`:(literal)${path}`]
        // staged rename은 원래 경로도 pathspec에 있어야 rename으로 감지된다(실측) —
        // 없으면 similarity 계산이 깨져 "새 파일 추가"로 위장된다
        if (options.staged && options.origPath != null) {
          assertRepoRelative(options.origPath)
          pathspecs.push(`:(literal)${options.origPath}`)
        }
        // -M: 사용자 전역 diff.renames=false여도 rename 감지를 고정한다 —
        // rename이 del+add 2파일 patch로 갈라지면 단일 파일 전용 parsePatch가 오분류한다(실측)
        const args = options.staged
          ? ['diff', '--cached', '-M', '--no-color', '--no-ext-diff', '--', ...pathspecs]
          : ['diff', '--no-color', '--no-ext-diff', '--', ...pathspecs]
        return parsePatch((await execGitOrThrow(args, { cwd })).stdout)
      },
    },
    history: {
      async list(limit) {
        const cwd = await topLevel()
        // NaN은 min/max를 그대로 통과한다 — 유한수가 아니면 기본값으로
        const safeLimit = Number.isFinite(limit)
          ? Math.min(Math.max(Math.trunc(limit), 1), 10000)
          : 50
        const args = [
          'log',
          `--max-count=${safeLimit}`,
          '--no-show-signature',
          // clone 기본 장식의 origin/HEAD와 replace ref는 배지 소음이다 — 장식에서 제외한다 (실측 확인)
          '--decorate-refs-exclude=refs/remotes/*/HEAD',
          '--decorate-refs-exclude=refs/replace/*',
          // 전체 그래프(피드백 4) — 로컬·원격·태그를 전부 순회한다. --exclude는 뒤의 --all에만
          // 적용되며, refs/stash를 빼지 않으면 보관함 WIP 커밋 3형제가, refs/notes를 빼지 않으면
          // 노트 커밋이 역사에 등장한다(실측 1). refs/replace는 같은 계열의 예방 제외다
          '--exclude=refs/stash',
          '--exclude=refs/notes/*',
          '--exclude=refs/replace/*',
          '--all',
          // 타임스탬프가 같은 커밋(스크립트 연속 커밋 등)에서도 부모가 자식보다 아래에 오도록
          // 고정한다 — 레인 그래프는 "기다리던 커밋이 아래에 나타난다"를 전제한다 (실측: 동률에서 유령 레인)
          '--date-order',
          '--format=%H%x1f%h%x1f%an%x1f%ct%x1f%D%x1f%P%x1f%s',
          '-z',
        ]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          // 아직 커밋이 없는 저장소(unborn HEAD)는 빈 역사다 — --all은 exit 0 빈 출력이지만(실측 3) 심층 방어로 남긴다
          if (result.stderr.includes('does not have any commits')) return []
          throw new GitError(args, result)
        }
        return parseLog(result.stdout)
      },
    },
    sync: {
      async push() {
        const cwd = await topLevel()
        const remotes = await execGitOrThrow(['remote'], { cwd })
        const remoteNames = remotes.stdout
          .trim()
          .split('\n')
          .filter((name) => name !== '')
        if (remoteNames.length === 0) {
          throw new Error('백업할 원격 저장소가 없어요. 먼저 원격 저장소를 연결해 주세요.')
        }
        // 사용자 직관대로 origin을 우선하고, 없으면 (git remote 출력 = 알파벳순) 첫 remote
        const targetRemote = remoteNames.includes('origin') ? 'origin' : remoteNames[0]!
        const branch = await execGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd })
        const upstream = await execGit(
          ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
          { cwd },
        )
        // upstream이 "현재 이름과 같은" 원격 브랜치일 때만 평범한 push —
        // rename 뒤에는 옛 이름의 upstream이 남아(git branch -m이 merge ref 유지 — 통합 리뷰 실측)
        // 평범한 push가 원어 에러로 죽는다. 그 경우 아래의 -u 재연결 경로로 태운다
        if (
          upstream.exitCode === 0 &&
          branch.exitCode === 0 &&
          upstream.stdout.trim().endsWith(`/${branch.stdout.trim()}`)
        ) {
          // push.default=matching 같은 사용자 전역 설정이 다른 브랜치까지 올리지 않게 고정한다
          const plain = await execGit(['-c', 'push.default=simple', 'push'], { cwd })
          if (plain.exitCode !== 0) {
            rejectIfRemoteAhead(plain)
            throw new GitError(['-c', 'push.default=simple', 'push'], plain)
          }
          return
        }
        // 아직 커밋이 없으면 올릴 것이 없다 — 원문 git 에러 대신 읽히는 메시지로
        const head = await execGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd })
        if (head.exitCode !== 0) {
          throw new Error('아직 저장된 시점이 없어요. 먼저 저장(commit)한 뒤 백업해 주세요.')
        }
        // detached HEAD에서는 올릴 브랜치가 없다 — 원문 git 에러 대신 읽히는 메시지로
        if (branch.exitCode !== 0) {
          throw new Error('지금은 브랜치가 아닌 시점에 있어요. 브랜치로 이동한 뒤 백업해 주세요.')
        }
        // 첫 백업(또는 이름이 어긋난 upstream 재연결) — 현재 브랜치를 remote에 연결하며 올린다.
        // --end-of-options: 대시로 시작하는 remote 이름이 플래그로 해석되는 것을 차단
        const linked = await execGit(['push', '-u', '--end-of-options', targetRemote, 'HEAD'], {
          cwd,
        })
        if (linked.exitCode !== 0) {
          rejectIfRemoteAhead(linked)
          throw new GitError(['push', '-u', '--end-of-options', targetRemote, 'HEAD'], linked)
        }
      },
      async pull() {
        const cwd = await topLevel()
        const remotes = await execGitOrThrow(['remote'], { cwd })
        if (remotes.stdout.trim() === '') {
          throw new Error('받아올 원격 저장소가 없어요. 먼저 원격 저장소를 연결해 주세요.')
        }
        const classify = (output: string): PullResult['outcome'] => {
          if (output.includes('Already up to date')) return 'up-to-date'
          if (output.includes('Fast-forward')) return 'fast-forward'
          return 'merged'
        }
        const run = () => execGit(['pull', '--no-rebase', '--no-edit'], { cwd })
        const first = await run()
        const firstOut = first.stdout + first.stderr
        if (first.exitCode === 0) return { outcome: classify(firstOut), autoShelved: false }
        if (firstOut.includes('you have unmerged files')) {
          throw new Error('겹침(!)을 모두 정리해야 받아올 수 있어요.')
        }
        if (firstOut.includes('no tracking information')) {
          throw new Error('이 실험 공간은 아직 원격과 연결되지 않았어요. 먼저 백업(push)으로 연결해 주세요.')
        }
        if (firstOut.includes('CONFLICT') || firstOut.includes('Automatic merge failed')) {
          return { outcome: 'conflict', autoShelved: false }
        }
        if (!firstOut.includes('would be overwritten')) {
          throw new GitError(['pull', '--no-rebase', '--no-edit'], first)
        }
        // 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 진행한다 (merge·switch와 동일 패턴)
        await execGitOrThrow(['stash', 'push', '-u', '-m', PULL_SHELF_MESSAGE], { cwd })
        const second = await run()
        const secondOut = second.stdout + second.stderr
        if (second.exitCode === 0) return { outcome: classify(secondOut), autoShelved: true }
        if (secondOut.includes('CONFLICT') || secondOut.includes('Automatic merge failed')) {
          return { outcome: 'conflict', autoShelved: true }
        }
        throw new GitError(['pull', '--no-rebase', '--no-edit'], second)
      },
      async branchStatus() {
        const cwd = await topLevel()
        const branch = await execGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd })
        if (branch.exitCode !== 0) return { branch: null, hasUpstream: false, upstream: null }
        // 실측: branch.<name>.remote/merge 설정만으로는 해석되지 않고, remote-tracking ref까지
        // 있어야 exit 0이다 — "원격에 실제로 올라간 적 있음"을 뜻해 리뷰 요청 전 검사에 맞다
        const upstream = await execGit(
          ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
          { cwd },
        )
        const upstreamName = upstream.exitCode === 0 ? upstream.stdout.trim() : null
        return {
          branch: branch.stdout.trim(),
          hasUpstream: upstreamName !== null,
          upstream: upstreamName,
        }
      },
      async remoteUrl() {
        const cwd = await topLevel()
        const remotes = await execGitOrThrow(['remote'], { cwd })
        const remoteNames = remotes.stdout
          .trim()
          .split('\n')
          .filter((name) => name !== '')
        if (remoteNames.length === 0) return null
        // push와 동일 규칙 — origin 우선, 없으면 (git remote 출력 = 알파벳순) 첫 remote
        const target = remoteNames.includes('origin') ? 'origin' : remoteNames[0]!
        const url = await execGit(['remote', 'get-url', target], { cwd })
        return url.exitCode === 0 ? url.stdout.trim() : null
      },
    },
    commits: {
      async create(message) {
        const cwd = await topLevel()
        // 메시지는 stdin으로 전달해 따옴표·개행 이스케이프 문제를 피한다.
        // 빈 메시지는 git이 거부한다 — GitError로 전파된다.
        const result = await execGit(['commit', '-F', '-'], { cwd, stdin: message })
        if (result.exitCode !== 0) {
          // 겹침이 남은 채 저장(병합 마무리) 시도 — 원어 에러 대신 다음 행동을 안내한다 (리뷰 실측)
          if (result.stderr.includes('unmerged files')) {
            throw new Error('겹침(!)을 모두 정리해야 저장할 수 있어요.')
          }
          throw new GitError(['commit', '-F', '-'], result)
        }
      },
      async show(hash) {
        const cwd = await topLevel()
        assertFullHash(hash)
        const showArgs = [
          'show',
          '-s',
          '--no-show-signature',
          '--format=%H%x1f%h%x1f%an%x1f%ct%x1f%P%x1f%s%x1f%b',
          '--end-of-options',
          hash,
        ]
        const metaRaw = await execGit(showArgs, { cwd })
        if (metaRaw.exitCode !== 0) {
          if (metaRaw.stderr.includes('bad object')) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
          throw new GitError(showArgs, metaRaw)
        }
        const meta = parseCommitMeta(metaRaw.stdout)
        const firstParent = meta.parents[0] ?? null
        // 병합 커밋에 diff-tree 기본 호출은 빈 출력이다(실측) — 부모가 있으면 첫 부모를 명시한다.
        // root 커밋만 --root diff-tree를 쓴다.
        const filesArgs = firstParent
          ? ['diff', '--name-status', '-M', '-z', firstParent, hash]
          : ['diff-tree', '--no-commit-id', '--root', '-r', '-M', '-z', '--name-status', hash]
        const filesRaw = await execGitOrThrow(filesArgs, { cwd })
        return { ...meta, files: parseNameStatus(filesRaw.stdout) }
      },
      async diffFile(hash, path, origPath) {
        const cwd = await topLevel()
        assertFullHash(hash)
        assertRepoRelative(path)
        if (origPath != null) assertRepoRelative(origPath)
        const pathspecs =
          origPath != null ? [`:(literal)${path}`, `:(literal)${origPath}`] : [`:(literal)${path}`]
        // 첫 부모 확인 — root 커밋(부모 없음)은 --root diff-tree로 다룬다 (병합 커밋 diff-tree는 빈 출력).
        // rev-parse는 root와 사라진 해시를 구분하지 못한다 — 커밋 존재를 따로 확인해 읽히는 에러를 낸다
        const parent = await execGit(['rev-parse', '-q', '--verify', `${hash}^1`], { cwd })
        if (parent.exitCode !== 0) {
          const exists = await execGit(['rev-parse', '-q', '--verify', `${hash}^{commit}`], { cwd })
          if (exists.exitCode !== 0) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
        }
        const args =
          parent.exitCode === 0
            ? [
                'diff',
                '-M',
                '--no-color',
                '--no-ext-diff',
                '--end-of-options',
                parent.stdout.trim(),
                hash,
                '--',
                ...pathspecs,
              ]
            : [
                'diff-tree',
                '--no-commit-id',
                '--root',
                '-r',
                '-p',
                '-M',
                '--no-color',
                '--no-ext-diff',
                '--end-of-options',
                hash,
                '--',
                ...pathspecs,
              ]
        return parsePatch((await execGitOrThrow(args, { cwd })).stdout)
      },
      async restoreFile(hash, path) {
        const cwd = await topLevel()
        assertFullHash(hash)
        assertRepoRelative(path)
        // 충돌(unmerged) 파일 가드 — checkout이 index를 덮어 충돌이 해소된 것처럼 위장된다 (discard 가드와 동일 계열)
        const unmerged = await execGitOrThrow(['ls-files', '-u', '--', `:(literal)${path}`], { cwd })
        if (unmerged.stdout.trim() !== '') {
          throw new Error(
            '충돌 중인 파일은 다른 시점 내용으로 덮을 수 없어요. 충돌 화면에서 한쪽을 고르거나 병합을 취소해 주세요.',
          )
        }
        // merging·reverting 도중의 적용은 병합 index를 중간 변경하고, stash도 unmerged index에서
        // 원문 에러로 죽는다(품질 리뷰 실측) — revert와 동일 관례로 먼저 마무리를 안내한다
        const gitDir = (await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })).stdout.trim()
        if (detectState(await readGitDirMarkers(gitDir)) !== 'normal') {
          throw new Error('지금 진행 중인 작업을 먼저 마무리하거나 취소해야 적용할 수 있어요.')
        }
        // 사전 검사 — stash 후 checkout이 실패하면 사용자 변경만 보관함으로 사라진다.
        // 그 시점에 파일이 있는지(ls-tree)와 해시 존재를 먼저 확인한다 (실측: 없는 해시는 'not a tree object')
        const treeArgs = ['ls-tree', '-r', '--end-of-options', hash, '--', `:(literal)${path}`]
        const tree = await execGit(treeArgs, { cwd })
        if (tree.exitCode !== 0) {
          if (tree.stderr.includes('not a tree object')) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
          throw new GitError(treeArgs, tree)
        }
        if (tree.stdout.trim() === '') {
          throw new Error('그 시점에는 이 파일이 없어요.')
        }
        // dirty 판정 — staged/unstaged/untracked 어느 쪽이든 status가 이 파일 행을 낸다.
        // 파일 단위 stash push는 staged-only 변경도 함께 보관한다 (플랜 서두 실측 기록 1)
        const dirty = await execGitOrThrow(
          ['status', '--porcelain=v2', '-uall', '-z', '--', `:(literal)${path}`],
          { cwd },
        )
        const autoShelved = dirty.stdout.trim() !== ''
        if (autoShelved) {
          // 스펙 원칙(§6): 덮기 전 자동 보관 — switch/merge/pull/revert와 동일 패턴의 파일 단위 판
          await execGitOrThrow(
            ['stash', 'push', '-u', '-m', RESTORE_FILE_SHELF_MESSAGE, '--', `:(literal)${path}`],
            { cwd },
          )
        }
        await execGitOrThrow(['checkout', '--end-of-options', hash, '--', `:(literal)${path}`], {
          cwd,
        })
        return { autoShelved }
      },
      async diffAgainstWorktree(hash, path, origPath) {
        const cwd = await topLevel()
        assertFullHash(hash)
        assertRepoRelative(path)
        if (origPath != null) assertRepoRelative(origPath)
        // diffFile과 동일 — rename 감지를 위해 원래 경로도 pathspec에 넣는다
        const pathspecs =
          origPath != null ? [`:(literal)${path}`, `:(literal)${origPath}`] : [`:(literal)${path}`]
        const args = [
          'diff',
          '-M',
          '--no-color',
          '--no-ext-diff',
          '--end-of-options',
          hash,
          '--',
          ...pathspecs,
        ]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          // 실측 stderr: "fatal: bad object <hash>" — 사라진(존재하지 않는) 해시
          if (result.stderr.includes('bad object')) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
          throw new GitError(args, result)
        }
        return parsePatch(result.stdout)
      },
      async cherryPick(hash) {
        const cwd = await topLevel()
        assertFullHash(hash)
        // merging·reverting 도중의 cherry-pick은 진행 중 상태를 오염시킨다 — revert와 동일 관례로 먼저 마무리를 안내한다
        const gitDir = (await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })).stdout.trim()
        if (detectState(await readGitDirMarkers(gitDir)) !== 'normal') {
          throw new Error('지금 진행 중인 작업을 먼저 마무리하거나 취소해야 가져올 수 있어요.')
        }
        const runOnce = () => execGit(['cherry-pick', '--no-edit', '--end-of-options', hash], { cwd })
        const classify = async (
          result: GitResult,
          autoShelved: boolean,
        ): Promise<CherryPickResult | null> => {
          if (result.exitCode === 0) return { outcome: 'picked', autoShelved }
          const output = result.stdout + result.stderr
          // merge commit은 -m 없이 거부된다(실측 5-ⓐ) — revert와 달리 재시도하지 않는다:
          // "이 저장만"과 병합 전체 가져오기는 의미가 다르다 (추측 금지 원칙)
          if (output.includes('is a merge but no -m option')) {
            throw new Error('합쳐진 저장은 통째로 가져올 수 없어요. 안에 있는 저장을 하나씩 가져와 주세요.')
          }
          if (output.includes('bad object')) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
          // 이미 반영된 저장 — CHERRY_PICK_HEAD가 남는다(실측 5-ⓓ). 빈 진행 상태를 정리하고 알려만 준다
          if (output.includes('is now empty')) {
            await execGitOrThrow(['cherry-pick', '--abort'], { cwd })
            return { outcome: 'empty', autoShelved }
          }
          if (output.includes('CONFLICT') || output.includes('after resolving the conflicts')) {
            return { outcome: 'conflict', autoShelved }
          }
          return null
        }
        const first = await runOnce()
        const classified = await classify(first, false)
        if (classified !== null) return classified
        if (!(first.stdout + first.stderr).includes('would be overwritten')) {
          throw new GitError(['cherry-pick', '--no-edit', '--end-of-options', hash], first)
        }
        // 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 진행한다 (switch·merge·pull·revert와 동일 패턴)
        await execGitOrThrow(['stash', 'push', '-u', '-m', CHERRY_PICK_SHELF_MESSAGE], { cwd })
        const second = await runOnce()
        const secondClassified = await classify(second, true)
        if (secondClassified !== null) return secondClassified
        throw new GitError(['cherry-pick', '--no-edit', '--end-of-options', hash], second)
      },
      async cherryPickAbort() {
        const cwd = await topLevel()
        const result = await execGit(['cherry-pick', '--abort'], { cwd })
        if (result.exitCode !== 0) {
          // 실측 5-ⓔ stderr: "error: no cherry-pick or revert in progress"
          if (result.stderr.includes('cherry-pick or revert in progress')) {
            throw new Error('지금은 가져오는 중이 아니에요.')
          }
          throw new GitError(['cherry-pick', '--abort'], result)
        }
      },
      async createTag(name, hash) {
        const cwd = await topLevel()
        assertFullHash(hash)
        // 태그 이름 선검증 — branch create/rename의 check-ref-format 관례를 태그 네임스페이스로 (실측 9)
        const valid = await execGit(['check-ref-format', `refs/tags/${name}`], { cwd })
        if (valid.exitCode !== 0) {
          throw new Error(`"${name}"라는 이름으로는 만들 수 없어요. 공백 없이 지어 주세요.`)
        }
        const args = ['tag', '--end-of-options', name, hash]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('already exists')) {
            throw new Error(`"${name}"는 이미 있는 태그예요. 다른 이름을 지어 주세요.`)
          }
          // 실측 9 stderr: "nonexistent object" — 목록이 낡아 사라진 해시
          if (result.stderr.includes('nonexistent object')) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
          throw new GitError(args, result)
        }
      },
      async undoLast(hash) {
        const cwd = await topLevel()
        assertFullHash(hash)
        // merging 등 도중의 reset은 진행 중 작업을 반쯤 무너뜨린다 — revert 관례로 먼저 마무리를 안내한다
        const gitDir = (await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })).stdout.trim()
        if (detectState(await readGitDirMarkers(gitDir)) !== 'normal') {
          throw new Error('지금 진행 중인 작업을 먼저 마무리하거나 취소해야 실행취소할 수 있어요.')
        }
        // 화면 목록이 낡은 채 실행취소하면 엉뚱한 저장이 물린다(CLI 경합) — 실제 HEAD와 일치를 확인한다
        const head = await execGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd })
        if (head.exitCode !== 0 || head.stdout.trim() !== hash) {
          throw new Error('가장 최근 저장이 바뀌었어요. 새로고침 후 다시 확인해 주세요.')
        }
        // 루트 커밋(부모 없음) — HEAD~1이 없다(실측 8: 조용히 exit 1). 원문 git 에러 대신 읽히는 메시지로
        const parent = await execGit(['rev-parse', '-q', '--verify', 'HEAD~1'], { cwd })
        if (parent.exitCode !== 0) {
          throw new Error('맨 처음 저장은 실행취소할 수 없어요.')
        }
        // --mixed: 커밋만 물리고 내용은 작업 폴더에 그대로 남긴다 — 유실 없음 (스펙 §6 계열)
        await execGitOrThrow(['reset', '--mixed', 'HEAD~1'], { cwd })
      },
      async reword(hash, message) {
        const cwd = await topLevel()
        assertFullHash(hash)
        const gitDir = (await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })).stdout.trim()
        if (detectState(await readGitDirMarkers(gitDir)) !== 'normal') {
          throw new Error('지금 진행 중인 작업을 먼저 마무리하거나 취소해야 메시지를 고칠 수 있어요.')
        }
        const head = await execGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd })
        if (head.exitCode !== 0 || head.stdout.trim() !== hash) {
          throw new Error('가장 최근 저장이 바뀌었어요. 새로고침 후 다시 확인해 주세요.')
        }
        // amend는 staged를 조용히 흡수한다 — 메시지만 바꾸는 의도와 어긋나므로 거부한다 (실측 7: --cached --quiet)
        const staged = await execGit(['diff', '--cached', '--quiet'], { cwd })
        if (staged.exitCode !== 0) {
          throw new Error('저장 예정에 올린 파일이 있어요 — 함께 들어가지 않게 먼저 비워 주세요.')
        }
        // 메시지만 교체(실측 7: staged 없음 + amend -F - → tree 불변) — stdin으로 개행·따옴표 안전.
        // --allow-empty: 빈 커밋의 메시지 고치기가 "would make it empty" 원어로 죽지 않게 (품질 리뷰)
        await execGitOrThrow(['commit', '--amend', '--allow-empty', '-F', '-'], { cwd, stdin: message })
      },
      async revert(hash) {
        const cwd = await topLevel()
        assertFullHash(hash)
        // merging·reverting 도중의 revert는 MERGE_HEAD를 소비해 병합을 거짓 메시지로
        // 완결시키거나, 해소된 충돌을 무통보로 재오염시킨다(통합 리뷰 실측) — 먼저 마무리를 안내한다
        const gitDir = (await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })).stdout.trim()
        if (detectState(await readGitDirMarkers(gitDir)) !== 'normal') {
          throw new Error('지금 진행 중인 작업을 먼저 마무리하거나 취소해야 되돌릴 수 있어요.')
        }
        const runOnce = async (): Promise<GitResult> => {
          const run = (extra: string[]) =>
            execGit(['revert', '--no-edit', ...extra, '--end-of-options', hash], { cwd })
          let result = await run([])
          // merge commit은 -m 없이는 거부된다(실측) — 앱 원칙대로 첫 부모 기준으로 재시도
          if (result.exitCode !== 0 && result.stderr.includes('is a merge but no -m option')) {
            result = await run(['-m', '1'])
          }
          return result
        }
        const classify = (result: GitResult, autoShelved: boolean): RevertResult | null => {
          if (result.exitCode === 0) return { outcome: 'reverted', autoShelved }
          const output = result.stdout + result.stderr
          if (output.includes('CONFLICT') || output.includes('after resolving the conflicts')) {
            return { outcome: 'conflict', autoShelved }
          }
          if (output.includes('nothing to commit')) {
            throw new Error(
              '되돌려도 바뀌는 내용이 없어요 — 이미 지금 내용에 반영되어 있는 저장이에요.',
            )
          }
          if (output.includes('bad object')) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
          return null
        }
        const first = await runOnce()
        const classified = classify(first, false)
        if (classified !== null) return classified
        if (!(first.stdout + first.stderr).includes('would be overwritten')) {
          throw new GitError(['revert', '--no-edit', '--end-of-options', hash], first)
        }
        // 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 진행한다 (switch·merge·pull과 동일 패턴)
        await execGitOrThrow(['stash', 'push', '-u', '-m', REVERT_SHELF_MESSAGE], { cwd })
        const second = await runOnce()
        const secondClassified = classify(second, true)
        if (secondClassified !== null) return secondClassified
        throw new GitError(['revert', '--no-edit', '--end-of-options', hash], second)
      },
      async revertAbort() {
        const cwd = await topLevel()
        const result = await execGit(['revert', '--abort'], { cwd })
        if (result.exitCode !== 0) {
          // 실측 stderr: "error: no cherry-pick or revert in progress" — 부분 문구로 잡는다
          if (result.stderr.includes('revert in progress')) {
            throw new Error('지금은 되돌리는 중이 아니에요.')
          }
          throw new GitError(['revert', '--abort'], result)
        }
      },
    },
  }
}
