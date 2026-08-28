import { FolderGit2, FolderOpen, GitBranch, GitCommitHorizontal, GitFork, ScanText } from 'lucide-react'
import { Button } from '../ui/Button'
import { ProductIcon } from '../ui/ProductIcon'
import { T } from '../terms'
import { shortenParent } from './worktree-label'
import './repo-picker.css'

interface RepoPickerProps {
  onOpen(): void
  onClone(): void
  onInit(): void
  /** 최근 연 저장소 — 최신이 앞 (E15a). 누르면 그 저장소를 이 창에서 연다 */
  recent: string[]
  /** `~` 축약용 홈 경로 — 못 구했으면 빈 문자열(순수 함수가 축약 없이 처리) */
  home: string
  onOpenRecent(path: string): void
  error: string | null
}

const folderName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

/**
 * 저장소가 없는 창의 첫 화면. E15b 전에는 "저장소 열기" 버튼 하나뿐이었고, ⌘N이 만드는 빈 창이
 * 그 선재 결함을 처음으로 아프게 했다 — "새 창 = 항상 OS 다이얼로그부터"라 최근 10개(E15a)가
 * 무의미해진다. 행 표기는 헤더 전환기와 같은 규칙이다(이름 굵게 + 그 아래 경로 흐리게).
 */
export function RepoPicker({ onOpen, onClone, onInit, recent, home, onOpenRecent, error }: RepoPickerProps) {
  return (
    <div className="repo-picker">
      <div className="repo-picker__card">
        <section className="repo-picker__intro" aria-labelledby="repo-picker-title">
          <div className="repo-picker__brand">
            <span className="repo-picker__icon-wrap">
              <ProductIcon size={62} label="여울" />
            </span>
            <span>YEOUL</span>
          </div>
          <span className="repo-picker__eyebrow">Git이 흐르는 방식 그대로</span>
          <h1 id="repo-picker-title">
            복잡한 작업도
            <br />한눈에 이어 보세요.
          </h1>
          <p className="repo-picker__desc">
            여러 {T.branch}와 {T.worktree}의 흐름을 놓치지 않고,
            <br />변경 검토부터 안전한 {T.commit}과 통합까지 이어가요.
          </p>
          <ul className="repo-picker__features" aria-label="여울의 주요 기능">
            <li>
              <ScanText size={15} aria-hidden="true" /> 변경을 나란히 검토
            </li>
            <li>
              <GitBranch size={15} aria-hidden="true" /> {T.branch}와 {T.worktree} 한곳에
            </li>
            <li>
              <GitCommitHorizontal size={15} aria-hidden="true" /> 흐름을 보며 안전하게 저장
            </li>
          </ul>
        </section>

        <section className="repo-picker__workspace" aria-labelledby="repo-picker-start-title">
          <div className="repo-picker__workspace-heading">
            <div>
              <span>작업 공간</span>
              <h2 id="repo-picker-start-title">어디서 시작할까요?</h2>
            </div>
            <span className="repo-picker__status">준비됨</span>
          </div>
          <div className="repo-picker__actions">
            <Button variant="primary" onPress={onOpen} testId="open-repo">
              <FolderOpen size={16} aria-hidden="true" /> 저장소 열기
            </Button>
            <Button variant="neutral" onPress={onClone} testId="clone-repo">
              <GitFork size={16} aria-hidden="true" /> 원격 저장소 복제
            </Button>
            <Button variant="ghost" onPress={onInit} testId="init-repo">
              <FolderGit2 size={16} aria-hidden="true" /> 새 저장소 만들기
            </Button>
          </div>
          {recent.length > 0 && (
            <div className="repo-picker__recent">
              <h3 className="repo-picker__recent-title">최근 연 저장소</h3>
              <ul className="repo-picker__recent-list" data-testid="repo-picker-recent">
                {recent.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      className="repo-picker__recent-item"
                      onClick={() => onOpenRecent(path)}
                      data-testid={`repo-picker-recent-${path}`}
                    >
                      <span className="repo-picker__recent-mark" aria-hidden="true" />
                      <span className="repo-picker__recent-copy">
                        <span className="repo-picker__recent-name">{folderName(path)}</span>
                        <span className="repo-picker__recent-path">{shortenParent(path, home)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <p className="repo-picker__error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
