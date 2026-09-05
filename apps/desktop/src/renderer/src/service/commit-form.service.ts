import type { CommitFormModel } from '../adapter/commit-form.adapter'
function get(model: CommitFormModel, busy: boolean, message: string) {
  if (busy) return { disabled: true, label: '작업 중…' }
  if (model.conflicts)
    return { disabled: true, label: `충돌 ${model.conflicts}개를 먼저 해결해 주세요` }
  if (!model.stagedCount && !model.merging)
    return { disabled: true, label: '이 작업 폴더의 파일을 스테이지에 추가해 주세요' }
  if (!message.trim()) return { disabled: true, label: '커밋 메시지를 입력해 주세요' }
  return {
    disabled: false,
    label:
      model.merging && !model.stagedCount
        ? '충돌 해결 완료 · 병합 커밋 가능'
        : `${model.stagedCount}개 파일 커밋`,
  }
}
export const commitFormPolicy = { availability: { get } }
