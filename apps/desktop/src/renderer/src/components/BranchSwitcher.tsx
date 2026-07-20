import { Check, ChevronDown, Plus } from 'lucide-react'
import { Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'
import type { BranchSummary } from '@git-gui/domain'
import { Button } from '../ui/Button'
import { Pictogram } from '../ui/Pictogram'
import { formatRelativeTime } from './relative-time'
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

/** 헤더 실험 공간 스위처 (⑧) — 목록에서 전환하거나 새로 만든다 */
export function BranchSwitcher({ branches, currentName, busy, onSwitch, onCreate, onManage }: BranchSwitcherProps) {
  return (
    <MenuTrigger>
      <Button variant="ghost" size="sm" isDisabled={busy} testId="header-branch">
        <Pictogram kind="branch" size={13} label="실험 공간 (branch)" />
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
          {branches.map((branch) => (
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
              <span className="branch-switcher__name">{branch.name}</span>
              <span className="branch-switcher__time">
                {formatRelativeTime(branch.committedAt, Date.now())}
              </span>
            </MenuItem>
          ))}
          <MenuItem
            id={NEW_KEY}
            className="branch-switcher__item branch-switcher__item--new"
            textValue="새 실험 공간 만들기"
            data-testid="branch-new"
          >
            <span className="branch-switcher__check" aria-hidden="true">
              <Plus size={12} />
            </span>
            <span className="branch-switcher__name">새 실험 공간 만들기…</span>
          </MenuItem>
          <MenuItem
            id={MANAGE_KEY}
            className="branch-switcher__item branch-switcher__item--new"
            textValue="실험 공간 관리"
            data-testid="branch-manage"
          >
            <span className="branch-switcher__check" aria-hidden="true" />
            <span className="branch-switcher__name">실험 공간 관리…</span>
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
