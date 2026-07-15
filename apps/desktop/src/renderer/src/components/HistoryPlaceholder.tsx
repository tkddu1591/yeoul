import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import { Pictogram } from '../ui/Pictogram'
import './history-placeholder.css'

/** 저장된 역사 자리 — 목록 엔진(log)은 다음 단계에서 붙는다 (스펙 5장 레이아웃의 자리 확보) */
export function HistoryPlaceholder() {
  return (
    <Panel title="저장된 역사" accessory={<Badge tone="git">log</Badge>}>
      <div className="history-placeholder">
        <Pictogram kind="commit" size={20} label="저장 시점" />
        <p>
          저장할 때마다 시점이 여기에 쌓여요.
          <br />
          목록 보기는 다음 업데이트에서 제공돼요.
        </p>
      </div>
    </Panel>
  )
}
