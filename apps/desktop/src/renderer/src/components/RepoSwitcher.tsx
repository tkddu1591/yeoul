import { Check, ChevronDown, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'
import { useEscapeFallback } from '../ui/use-escape-fallback'
import { Button } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'
import { pushRecentRepo } from './recent-repos'
import { shortenParent } from './worktree-label'
import './repo-switcher.css'

interface RepoSwitcherProps {
  /** 지금 열려 있는 저장소 절대 경로 */
  currentPath: string
  /** `~` 축약용 홈 경로 — 못 구했으면 빈 문자열(순수 함수가 축약 없이 처리) */
  home: string
  /** 최신이 앞 (E15a) */
  recent: string[]
  busy: boolean
  /** 경로를 주면 그것을, 안 주면 폴더 선택 다이얼로그를 연다 */
  onOpen(path?: string): void
}

const BROWSE_KEY = '__browse__'

const folderName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

/**
 * 헤더 저장소 전환기 (E15a) — 최근 연 저장소로 갈아타거나 다른 폴더를 연다.
 * 전환 기계(openRepository)는 처음부터 있었고 부를 방법만 없었다.
 *
 * 없어진 경로를 미리 흐리게 표시하지는 않는다(스펙 §3 대비 의도적 편차): 누르기 전에 알려면
 * 팝오버를 열 때마다 항목 수만큼 존재 확인 IPC를 돌아야 한다. 눌렀을 때 실패 문구가 뜨고
 * 목록에서 빠지는 것으로 충분하다.
 */
export function RepoSwitcher({ currentPath, home, recent, busy, onOpen }: RepoSwitcherProps) {
  // ESC fallback을 걸기 위해 제어형으로 둔다 (BranchSwitcher 관례)
  const [open, setOpen] = useState(false)
  useEscapeFallback(open, () => setOpen(false))
  // 지금 저장소는 목록에 없어도 항상 보인다 — 시작 시 복원된 저장소는 아직 목록에 없다.
  // 같은 규칙(중복 없이 최신이 앞)을 그대로 쓴다: 이미 맨 앞이면 결과가 recent와 같다
  const paths = pushRecentRepo(recent, currentPath)
  return (
    <MenuTrigger isOpen={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        isDisabled={busy}
        testId="repo-switcher"
        className="repo-switcher__trigger"
        aria-label="저장소 바꾸기"
      >
        <span className="app__repo">
          <strong>{folderName(currentPath)}</strong>
          {/* E7h ③ — 전환 완료(성공 후에만) 검증용 testid */}
          <Tooltip content={currentPath} summary={currentPath}>
            <span className="app__repo-path" data-testid="repo-path">
              {currentPath}
            </span>
          </Tooltip>
        </span>
        <ChevronDown size={12} aria-hidden="true" />
      </Button>
      <Popover className="repo-switcher__popover">
        <Menu
          className="repo-switcher__menu"
          onAction={(key) => {
            if (key === BROWSE_KEY) onOpen()
            else if (key !== currentPath) onOpen(String(key))
          }}
        >
          {paths.map((path) => (
            <MenuItem
              key={path}
              id={path}
              className="repo-switcher__item"
              textValue={path}
              data-testid={`repo-switcher-item-${path}`}
            >
              <span className="repo-switcher__check" aria-hidden="true">
                {path === currentPath ? <Check size={12} /> : null}
              </span>
              <span className="repo-switcher__label">
                <span className="repo-switcher__name">{folderName(path)}</span>
                <span className="repo-switcher__path">{shortenParent(path, home)}</span>
              </span>
            </MenuItem>
          ))}
          <MenuItem
            id={BROWSE_KEY}
            className="repo-switcher__item repo-switcher__item--browse"
            textValue="다른 폴더 열기"
            data-testid="repo-switcher-browse"
          >
            <span className="repo-switcher__check" aria-hidden="true">
              <FolderOpen size={12} />
            </span>
            <span className="repo-switcher__label">
              <span className="repo-switcher__name">다른 폴더 열기…</span>
            </span>
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
