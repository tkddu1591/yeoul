import { FolderOpen } from 'lucide-react'
import { Button } from '../ui/Button'
import { Pictogram } from '../ui/Pictogram'
import { T } from '../terms'
import { shortenParent } from './worktree-label'
import './repo-picker.css'

interface RepoPickerProps {
  onOpen(): void
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
export function RepoPicker({ onOpen, recent, home, onOpenRecent, error }: RepoPickerProps) {
  return (
    <div className="repo-picker">
      <div className="repo-picker__card">
        <div className="repo-picker__marks" aria-hidden="true">
          <Pictogram kind="commit" size={20} />
          <Pictogram kind="branch" size={20} />
          <Pictogram kind="shelf" size={20} />
        </div>
        <h1>Git GUI</h1>
        <p className="repo-picker__desc">
          프로젝트 폴더를 열면 바뀐 파일을 확인하고
          <br />
          안전하게 {T.commit}할 수 있어요.
        </p>
        <Button variant="primary" onPress={onOpen} testId="open-repo">
          <FolderOpen size={16} aria-hidden="true" /> 저장소 열기
        </Button>
        {recent.length > 0 && (
          <div className="repo-picker__recent">
            <h2 className="repo-picker__recent-title">최근 연 저장소</h2>
            <ul className="repo-picker__recent-list" data-testid="repo-picker-recent">
              {recent.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className="repo-picker__recent-item"
                    onClick={() => onOpenRecent(path)}
                    data-testid={`repo-picker-recent-${path}`}
                  >
                    <span className="repo-picker__recent-name">{folderName(path)}</span>
                    <span className="repo-picker__recent-path">{shortenParent(path, home)}</span>
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
      </div>
    </div>
  )
}
