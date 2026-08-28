import { Check, Moon, Sun } from 'lucide-react'
import { appearanceCatalog } from './appearance-catalog'
import type { Appearance } from '@git-gui/ipc-contract'

interface AppearanceSettingsPanelProps {
  appearance: Appearance
  onChange(appearance: Appearance): void
}

export function AppearanceSettingsPanel({ appearance, onChange }: AppearanceSettingsPanelProps) {
  return (
    <section className="settings-dialog__appearance" aria-labelledby="appearance-title">
      <div className="settings-dialog__appearance-heading">
        <span className="settings-dialog__eyebrow">나만의 작업 공간</span>
        <h2 id="appearance-title">화면 분위기</h2>
        <p>밝기는 모드로, 색의 결은 테마로 따로 골라요. 터미널도 함께 바뀝니다.</p>
      </div>

      <fieldset className="settings-dialog__appearance-group">
        <legend>모드</legend>
        <div className="settings-dialog__mode-options">
          {appearanceCatalog.mode.options.map((option) => {
            const selected = appearance.mode === option.value
            return (
              <label
                key={option.value}
                className="settings-dialog__mode-option"
                data-selected={selected || undefined}
                data-testid={`settings-mode-${option.value}`}
              >
                <input
                  className="settings-dialog__choice-input"
                  type="radio"
                  name="color-mode"
                  value={option.value}
                  checked={selected}
                  onChange={() => onChange({ ...appearance, mode: option.value })}
                />
                <span className="settings-dialog__mode-icon" aria-hidden="true">
                  {option.value === 'light' ? <Sun size={17} /> : <Moon size={17} />}
                </span>
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                {selected && <Check className="settings-dialog__choice-check" size={15} />}
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="settings-dialog__appearance-group">
        <legend>테마</legend>
        <div className="settings-dialog__theme-options">
          {appearanceCatalog.theme.options.map((option) => {
            const selected = appearance.theme === option.value
            return (
              <label
                key={option.value}
                className="settings-dialog__theme-option"
                data-selected={selected || undefined}
                data-color-theme={option.value}
                data-testid={`settings-theme-${option.value}`}
              >
                <input
                  className="settings-dialog__choice-input"
                  type="radio"
                  name="color-theme"
                  value={option.value}
                  checked={selected}
                  onChange={() => onChange({ ...appearance, theme: option.value })}
                />
                <span className="settings-dialog__theme-preview" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="settings-dialog__theme-copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                {selected && <Check className="settings-dialog__choice-check" size={15} />}
              </label>
            )
          })}
        </div>
      </fieldset>
    </section>
  )
}
