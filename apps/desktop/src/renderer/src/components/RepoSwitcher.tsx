import { Check, ChevronDown, FolderOpen, GitBranch } from 'lucide-react'
import { useRef, useState } from 'react'
import { Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'
import { useEscapeFallback } from '../ui/use-escape-fallback'
import type { WorkspaceInfo, WorkspaceRepository } from '@git-gui/ipc-contract'
import { Button } from '../ui/Button'
import { ContextMenu } from '../ui/ContextMenu'
import { Tooltip } from '../ui/Tooltip'
import { pushRecentRepo } from './recent-repos'
import { shortenParent } from './worktree-label'
import './repo-switcher.css'

interface RepoSwitcherProps {
  /** 지금 열려 있는 저장소 절대 경로 */
  currentPath: string
  workspace: WorkspaceInfo | null
  repository: WorkspaceRepository | null
  /** `~` 축약용 홈 경로 — 못 구했으면 빈 문자열(순수 함수가 축약 없이 처리) */
  home: string
  /** 최신이 앞 (E15a) */
  recent: string[]
  busy: boolean
  /** 경로를 주면 그것을, 안 주면 폴더 선택 다이얼로그를 연다 */
  onOpen(path?: string): void
  /** ⌥클릭·우클릭 "새 창에서 열기" — 이 창은 그대로 두고 새 창에서 연다 (E15b) */
  onOpenInNewWindow(path: string): void
  /** 우클릭 "새 탭에서 열기" — 이 탭은 그대로 두고 새 탭에서 연다 (E15c) */
  onOpenInNewTab(path: string): void
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
export function RepoSwitcher({
  currentPath,
  workspace,
  repository,
  home,
  recent,
  busy,
  onOpen,
  onOpenInNewWindow,
  onOpenInNewTab,
}: RepoSwitcherProps) {
  // ESC fallback을 걸기 위해 제어형으로 둔다 (BranchSwitcher 관례)
  const [open, setOpen] = useState(false)
  // 우클릭 메뉴 (E15b) — ⌥클릭의 발견 가능한 짝. E15c가 "새 탭에서 열기"를 짝으로 붙였다
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  // react-aria의 onAction은 수식 키를 전달하지 않는다(키보드 활성화와 클릭을 같은 콜백으로
  // 합치기 때문). 항목의 포인터 이벤트에서 altKey를 기억해 두고 onAction에서 읽는다 (E15b)
  const altRef = useRef(false)
  /**
   * 팝오버 여닫기는 **반드시** 이걸로 한다 (E15b 리뷰 I-3).
   *
   * `altRef`는 `onPointerDown`에서만 켜지고 `onAction`에서만 꺼졌다. 그래서 `onAction`이 안
   * 일어나는 취소(항목 밖으로 끌고 나가 떼기, ESC)면 `true`가 남고, **다음 활성화에
   * pointerdown이 없으면**(키보드) 그대로 실렸다 — 마우스로 다시 누르면 `onPointerDown`이
   * 덮어써서 안 드러나므로 **키보드 사용자에게만** 나타나는 결함이었다.
   *
   * 리뷰어 대조 실험(키 입력 완전히 동일 — ArrowDown ×2 → Enter): 대조군은 `windows=1
   * repo=pathB`(정상 전환), ⌥ 취소를 앞세우면 `windows=2 repo=pathA`(새 창이 열렸다).
   *
   * 팝오버가 닫히는 순간이 래치의 수명이 끝나는 순간이다 — 여는 쪽에서도 지우는 이유는
   * 값이 남는 경로를 하나라도 놓치지 않기 위해서다(어차피 pointerdown이 곧 덮어쓴다)
   */
  const changeOpen = (next: boolean) => {
    altRef.current = false
    setOpen(next)
  }
  useEscapeFallback(open, () => changeOpen(false))
  // 지금 저장소는 목록에 없어도 항상 보인다 — 시작 시 복원된 저장소는 아직 목록에 없다.
  // 같은 규칙(중복 없이 최신이 앞)을 그대로 쓴다: 이미 맨 앞이면 결과가 recent와 같다
  const paths = (workspace?.repositories ?? []).reduce(
    (current, item) => pushRecentRepo(current, item.path),
    pushRecentRepo(recent, currentPath),
  )
  const displayName = workspace?.name ?? folderName(currentPath)
  return (
    <>
      <MenuTrigger isOpen={open} onOpenChange={changeOpen}>
        {/* aria-label을 달지 않는다 (E15a 리뷰 ⑤) — 달면 안쪽 텍스트를 **덮어써서** 스크린 리더
            사용자는 지금 어느 저장소가 열려 있는지 못 듣는다. 예전 정적 <div>일 땐 그냥 읽혔고,
            본보기인 BranchSwitcher도 aria-label 없이 브랜치 이름이 접근 가능한 이름이 된다.
            ⌥ 힌트도 여기 넣지 않는다 — 같은 이유로 저장소 이름을 덮는다 (E15b) */}
        <Button
          variant="ghost"
          size="sm"
          isDisabled={busy}
          testId="repo-switcher"
          className="repo-switcher__trigger"
        >
          <span className="app__repo">
            <strong>{displayName}</strong>
            {workspace !== null && repository !== null && (
              <Tooltip
                content={`${workspace.path}\n현재 저장소: ${currentPath}`}
                summary={`${workspace.name} · ${repository.name}`}
              >
                <span className="repo-switcher__workspace-repository">
                  <GitBranch size={11} aria-hidden="true" />
                  <span>{repository.relativePath}</span>
                </span>
              </Tooltip>
            )}
            {workspace === null && (
              <Tooltip content={currentPath} summary={currentPath}>
                <span className="app__repo-path" data-testid="repo-path">{currentPath}</span>
              </Tooltip>
            )}
            {workspace !== null && (
              <>
                <span className="repo-switcher__test-path" data-testid="workspace-path">{workspace.path}</span>
                <span className="repo-switcher__test-path" data-testid="repo-path">{currentPath}</span>
              </>
            )}
          </span>
          <ChevronDown size={12} aria-hidden="true" />
        </Button>
        <Popover className="repo-switcher__popover">
          <Menu
            className="repo-switcher__menu"
            onAction={(key) => {
              const newWindow = altRef.current
              altRef.current = false
              if (key === BROWSE_KEY) {
                onOpen()
                return
              }
              const path = String(key)
              // ⌥클릭이면 새 창 (E15b). 지금 저장소여도 막지 않는다 — main이 중복을 막아 그
              // 창을 앞으로 가져오므로 "아무 일도 안 일어난 것처럼" 보인다(창이 늘지 않는다)
              if (newWindow) onOpenInNewWindow(path)
              else if (path !== currentPath) onOpen(path)
            }}
          >
            {paths.map((path) => (
              <MenuItem
                key={path}
                id={path}
                className="repo-switcher__item"
                textValue={path}
                data-testid={`repo-switcher-item-${path}`}
                onPointerDown={(event) => {
                  altRef.current = event.altKey
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  // 팝오버를 먼저 닫는다 — 열어 둔 채 body 포털 메뉴를 겹치면 팝오버의 바깥
                  // 클릭 처리와 ariaHideOutside가 그 메뉴까지 물어 간다
                  changeOpen(false)
                  setMenu({ x: event.clientX, y: event.clientY, path })
                }}
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
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              // 브라우저 관례 순서 — 탭이 창보다 앞 (E15c)
              key: 'new-tab',
              label: '새 탭에서 열기',
              onSelect: () => onOpenInNewTab(menu.path),
            },
            {
              key: 'new-window',
              label: '새 창에서 열기',
              onSelect: () => onOpenInNewWindow(menu.path),
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}
