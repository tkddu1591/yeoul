import { Check, ChevronDown, Folder, Plus } from 'lucide-react'
import { useState } from 'react'
import { Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover } from 'react-aria-components'
import { useEscapeFallback } from '../ui/use-escape-fallback'
import { useNow } from '../ui/use-now'
import type { BranchSummary } from '@git-gui/domain'
import { Button } from '../ui/Button'
import { Pictogram } from '../ui/Pictogram'
import { Tooltip } from '../ui/Tooltip'
import { branchDisplayName, groupBranches } from './branch-groups'
import { formatRelativeTime } from './relative-time'
import { T } from '../terms'
import './branch-switcher.css'

interface BranchSwitcherProps {
  branches: BranchSummary[]
  currentName: string | null
  busy: boolean
  onSwitch(name: string): void
  onCreate(): void
  onManage(): void
}

const NEW_KEY = '__new__'
const MANAGE_KEY = '__manage__'

/** 헤더 실험 공간 스위처 (⑧) — 목록에서 전환하거나 새로 만든다. '/' 접두사는 폴더로 묶는다 (피드백 5) */
export function BranchSwitcher({ branches, currentName, busy, onSwitch, onCreate, onManage }: BranchSwitcherProps) {
  // ESC fallback을 걸기 위해 제어형으로 둔다 — 그 외 동작은 기존과 같다 (ShelfPopover 관례)
  const [open, setOpen] = useState(false)
  useEscapeFallback(open, () => setOpen(false))
  // E14b — 목록이 길어도 구독은 하나다. renderItem이 이 값을 닫아 쓴다(행마다 부르면 브랜치 수만큼 구독자가 생긴다)
  const now = useNow()
  const grouped = groupBranches(branches)
  const renderItem = (branch: BranchSummary, display: string) => (
    <MenuItem
      key={branch.name}
      id={branch.name}
      className="branch-switcher__item"
      textValue={branch.name}
      data-testid={`branch-item-${branch.name}`}
    >
      <span className="branch-switcher__check" aria-hidden="true">
        {branch.isCurrent ? <Check size={12} /> : null}
      </span>
      <Tooltip content={branch.name} summary={branch.name}>
        <span className="branch-switcher__name">{display}</span>
      </Tooltip>
      <span className="branch-switcher__time">
        {formatRelativeTime(branch.committedAt, now)}
      </span>
    </MenuItem>
  )
  return (
    <MenuTrigger isOpen={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" isDisabled={busy} testId="header-branch">
        <Pictogram kind="branch" size={13} label={T.branch} />
        <span className="branch-switcher__current">{currentName ?? '(브랜치 없음)'}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </Button>
      <Popover className="branch-switcher__popover">
        <Menu
          className="branch-switcher__menu"
          onAction={(key) => {
            if (key === NEW_KEY) onCreate()
            else if (key === MANAGE_KEY) onManage()
            else if (key !== currentName) onSwitch(String(key))
          }}
        >
          {grouped.loose.map((branch) => renderItem(branch, branch.name))}
          {grouped.folders.map((folder) => (
            <MenuSection key={folder.name} className="branch-switcher__section">
              <Header className="branch-switcher__folder">
                <Folder size={11} aria-hidden="true" /> {folder.name}/
              </Header>
              {folder.branches.map((branch) => renderItem(branch, branchDisplayName(branch.name)))}
            </MenuSection>
          ))}
          <MenuItem
            id={NEW_KEY}
            className="branch-switcher__item branch-switcher__item--new"
            textValue={`새 ${T.branch} 만들기`}
            data-testid="branch-new"
          >
            <span className="branch-switcher__check" aria-hidden="true">
              <Plus size={12} />
            </span>
            <span className="branch-switcher__name">새 {T.branch} 만들기…</span>
          </MenuItem>
          <MenuItem
            id={MANAGE_KEY}
            className="branch-switcher__item branch-switcher__item--new"
            textValue={`${T.branch} 관리`}
            data-testid="branch-manage"
          >
            <span className="branch-switcher__check" aria-hidden="true" />
            <span className="branch-switcher__name">{T.branch} 관리…</span>
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
