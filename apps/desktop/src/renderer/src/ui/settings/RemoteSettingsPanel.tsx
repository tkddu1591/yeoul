import { remoteFormPolicy } from '../../service/remote-form.service'
import { GitFork, Plus, Radio, Server, ShieldCheck } from 'lucide-react'
import { Button } from '../Button'
import type { RemoteInfo } from '@git-gui/domain'

export interface RemoteSettingsState {
  repository?: { path: string; name: string }
  items: RemoteInfo[]
  busy: boolean
  error: string | null
}

export interface RemoteDraft {
  name: string
  url: string
}

interface RemoteSettingsPanelProps {
  remote: RemoteSettingsState
  draft: RemoteDraft
  onChangeDraft(draft: RemoteDraft): void
  onAdd(name: string, url: string): Promise<boolean>
  onRemove(name: string): void
}

export function RemoteSettingsPanel({
  remote,
  draft,
  onChangeDraft,
  onAdd,
  onRemove,
}: RemoteSettingsPanelProps) {
  const validation = remoteFormPolicy.validation.get(draft)
  return (
    <section className="settings-dialog__page" aria-labelledby="remote-settings-title">
      <div className="settings-dialog__page-heading">
        <span className="settings-dialog__eyebrow">저장소 연결</span>
        <h2 id="remote-settings-title">{remote.repository?.name ?? '현재 저장소'} · Git 원격</h2>
        <p className="break-all text-xs!">{remote.repository?.path}</p>
        <p>코드를 주고받을 원격 주소를 관리해요. GitHub API 연결과 Git 인증은 서로 별개입니다.</p>
      </div>

      <section
        className="settings-dialog__remote-section"
        aria-labelledby="connected-remotes-title"
      >
        <div className="settings-dialog__section-heading">
          <div>
            <h3 id="connected-remotes-title">연결된 원격</h3>
            <span>{remote.items.length}개</span>
          </div>
          <small>Git에 설정된 credential helper와 SSH 키를 사용해요.</small>
        </div>

        {remote.items.length === 0 ? (
          <div className="settings-dialog__remote-empty">
            <span aria-hidden="true">
              <Radio size={20} />
            </span>
            <strong>아직 연결된 원격이 없어요</strong>
            <small>아래에서 주소를 추가하면 푸시와 풀에 사용할 수 있어요.</small>
          </div>
        ) : (
          <ul className="settings-dialog__remote-list">
            {remote.items.map((item) => (
              <li key={item.name} className="settings-dialog__remote">
                <span className="settings-dialog__remote-icon" aria-hidden="true">
                  <Server size={16} />
                </span>
                <span className="settings-dialog__remote-copy">
                  <span>
                    <strong>{item.name}</strong>
                    <small className="settings-dialog__connected-badge">주소 등록됨</small>
                  </span>
                  <code>{item.fetchUrl}</code>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  isDisabled={remote.busy}
                  onPress={() => onRemove(item.name)}
                >
                  제거
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form
        className="settings-dialog__remote-form"
        onSubmit={(event) => {
          event.preventDefault()
          void onAdd(draft.name, draft.url).then((added) => {
            if (added) onChangeDraft({ ...draft, url: '' })
          })
        }}
      >
        <div className="settings-dialog__remote-form-heading">
          <span aria-hidden="true">
            <GitFork size={17} />
          </span>
          <div>
            <h3>새 원격 추가</h3>
            <p>보통 첫 원격 이름은 origin을 사용해요.</p>
          </div>
        </div>
        <div className="settings-dialog__remote-fields">
          <label>
            <span>이름</span>
            <input
              value={draft.name}
              onChange={(event) => onChangeDraft({ ...draft, name: event.target.value })}
              placeholder="origin"
            />
          </label>
          <label>
            <span>원격 주소</span>
            <input
              value={draft.url}
              onChange={(event) => onChangeDraft({ ...draft, url: event.target.value })}
              placeholder="git@github.com:owner/repository.git"
            />
          </label>
        </div>
        <div className="settings-dialog__remote-form-footer">
          <span>
            <ShieldCheck size={14} aria-hidden="true" /> 토큰·비밀번호를 URL에 포함하지 마세요.
          </span>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            isDisabled={remote.busy || validation !== null}
          >
            <Plus size={14} aria-hidden="true" /> 원격 추가
          </Button>
        </div>
        {validation && <p className="text-xs text-(--color-text-muted)">{validation}</p>}
        {remote.error !== null && (
          <p className="settings-dialog__error" role="alert">
            {remote.error}
          </p>
        )}
      </form>
    </section>
  )
}
