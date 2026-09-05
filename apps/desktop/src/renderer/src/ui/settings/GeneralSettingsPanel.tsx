import { GitMerge, RefreshCw, ShieldCheck, Terminal, Workflow } from 'lucide-react'
import { Button } from '../Button'
import { T } from '../../terms'
import type { WorktreeSelectAction } from './worktree-select-action'
import type { PullMode } from './sync-settings'

export interface GeneralSettingsPreferences {
  worktreeSelectAction: WorktreeSelectAction
  pullMode: PullMode
  autoFetch: boolean
}

interface GeneralSettingsPanelProps {
  preferences: GeneralSettingsPreferences
  onChangeWorktreeSelectAction(action: WorktreeSelectAction): void
  onChangePullMode(mode: PullMode): void
  onChangeAutoFetch(enabled: boolean): void
  onRevealDiagnostics(): void
}

export function GeneralSettingsPanel({
  preferences,
  onChangeWorktreeSelectAction,
  onChangePullMode,
  onChangeAutoFetch,
  onRevealDiagnostics,
}: GeneralSettingsPanelProps) {
  return (
    <section className="settings-dialog__page" aria-labelledby="general-settings-title">
      <div className="settings-dialog__page-heading">
        <span className="settings-dialog__eyebrow">작업 흐름</span>
        <h2 id="general-settings-title">작업 동작</h2>
        <p>모든 저장소에 적용돼요. 변경 사항은 자동으로 저장됩니다.</p>
      </div>

      <fieldset className="settings-dialog__setting-card">
        <legend>{T.worktree}를 선택했을 때</legend>
        <p className="settings-dialog__setting-description">
          목록에서 {T.worktree}를 눌렀을 때 어느 범위까지 따라갈지 정해요.
        </p>
        <div className="settings-dialog__choice-list">
          <label
            className="settings-dialog__setting-option"
            data-selected={preferences.worktreeSelectAction === 'terminal' || undefined}
          >
            <span className="settings-dialog__setting-icon" aria-hidden="true">
              <Terminal size={16} />
            </span>
            <span className="settings-dialog__setting-copy">
              <strong>터미널만 따라가기</strong>
              <small>새 터미널만 그 폴더에서 열고, 화면의 저장소는 그대로 둬요.</small>
            </span>
            <input
              className="settings-dialog__option-input"
              type="radio"
              name="worktree-select-action"
              checked={preferences.worktreeSelectAction === 'terminal'}
              onChange={() => onChangeWorktreeSelectAction('terminal')}
              data-testid="settings-worktree-terminal"
            />
          </label>
          <label
            className="settings-dialog__setting-option"
            data-selected={preferences.worktreeSelectAction === 'switch-app' || undefined}
          >
            <span className="settings-dialog__setting-icon" aria-hidden="true">
              <Workflow size={16} />
            </span>
            <span className="settings-dialog__setting-copy">
              <strong>앱 전체 따라가기</strong>
              <small>
                변경·{T.history}·{T.branch}와 터미널을 모두 그 {T.worktree} 기준으로 바꿔요.
              </small>
            </span>
            <input
              className="settings-dialog__option-input"
              type="radio"
              name="worktree-select-action"
              checked={preferences.worktreeSelectAction === 'switch-app'}
              onChange={() => onChangeWorktreeSelectAction('switch-app')}
              data-testid="settings-worktree-switch"
            />
          </label>
        </div>
        <p className="settings-dialog__setting-note">
          우클릭 메뉴에서는 이 설정과 관계없이 두 동작을 언제든 고를 수 있어요.
        </p>
      </fieldset>

      <fieldset className="settings-dialog__setting-card">
        <legend>원격 변경을 받아올 때</legend>
        <p className="settings-dialog__setting-description">
          내 {T.commit}을 원격 최신과 합치는 방식을 골라요.
        </p>
        <div className="settings-dialog__choice-grid">
          <label
            className="settings-dialog__setting-option settings-dialog__setting-option--compact"
            data-selected={preferences.pullMode === 'merge' || undefined}
          >
            <span className="settings-dialog__setting-icon" aria-hidden="true">
              <GitMerge size={16} />
            </span>
            <span className="settings-dialog__setting-copy">
              <strong>{T.merge}하며 받기</strong>
              <small>필요할 때 병합 커밋으로 두 이력을 합쳐요.</small>
            </span>
            <input
              className="settings-dialog__option-input"
              type="radio"
              name="pull-mode"
              checked={preferences.pullMode === 'merge'}
              onChange={() => onChangePullMode('merge')}
              data-testid="settings-pull-merge"
            />
          </label>
          <label
            className="settings-dialog__setting-option settings-dialog__setting-option--compact"
            data-selected={preferences.pullMode === 'rebase' || undefined}
          >
            <span className="settings-dialog__setting-icon" aria-hidden="true">
              <Workflow size={16} />
            </span>
            <span className="settings-dialog__setting-copy">
              <strong>{T.rebase}로 받기</strong>
              <small>로컬 커밋을 원격 최신 커밋 위에 다시 적용해요.</small>
            </span>
            <input
              className="settings-dialog__option-input"
              type="radio"
              name="pull-mode"
              checked={preferences.pullMode === 'rebase'}
              onChange={() => onChangePullMode('rebase')}
              data-testid="settings-pull-rebase"
            />
          </label>
        </div>

        <label
          className="settings-dialog__toggle-row"
          data-selected={preferences.autoFetch || undefined}
        >
          <span className="settings-dialog__setting-icon" aria-hidden="true">
            <RefreshCw size={16} />
          </span>
          <span className="settings-dialog__setting-copy">
            <strong>10분마다 원격 새로고침</strong>
            <small>새 {T.branch}와 ↑↓ 차이를 자동으로 최신 상태로 유지해요.</small>
          </span>
          <span className="settings-dialog__switch" aria-hidden="true">
            <i />
          </span>
          <input
            className="settings-dialog__toggle-input"
            type="checkbox"
            checked={preferences.autoFetch}
            onChange={(event) => onChangeAutoFetch(event.target.checked)}
            data-testid="settings-auto-fetch"
          />
        </label>
      </fieldset>

      <section className="settings-dialog__diagnostics" aria-labelledby="diagnostics-title">
        <span className="settings-dialog__diagnostics-icon" aria-hidden="true">
          <ShieldCheck size={18} />
        </span>
        <div>
          <h3 id="diagnostics-title">진단 자료는 이 Mac에만</h3>
          <p>런타임 로그와 크래시 덤프를 외부로 전송하지 않아요.</p>
        </div>
        <Button variant="ghost" size="sm" onPress={onRevealDiagnostics}>
          Finder에서 보기
        </Button>
      </section>
    </section>
  )
}
