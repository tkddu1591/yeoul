import { useReviewPreferences } from '../hook/use-review-preferences'
export function ReviewPreferencesPanel() {
  const preference = useReviewPreferences()
  return (
    <fieldset className="my-3 rounded border border-(--color-border) p-3">
      <legend className="text-sm">코드 검토와 목록</legend>
      <label className="mb-3 flex items-center justify-between gap-2 text-sm">
        코드 글자 크기
        <select
          className="rounded border border-(--color-border) bg-(--color-surface) px-2 py-1"
          value={preference.data.codeFontSize}
          onChange={(event) =>
            preference.selection.set({
              ...preference.data,
              codeFontSize: Number(event.target.value) as 12 | 14 | 16,
            })
          }
        >
          <option value={12}>12px</option>
          <option value={14}>14px</option>
          <option value={16}>16px</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-sm">
        통합 목록 간격
        <select
          className="rounded border border-(--color-border) bg-(--color-surface) px-2 py-1"
          value={preference.data.listDensity}
          onChange={(event) =>
            preference.selection.set({
              ...preference.data,
              listDensity: event.target.value as 'compact' | 'comfortable',
            })
          }
        >
          <option value="comfortable">여유롭게</option>
          <option value="compact">촘촘하게</option>
        </select>
      </label>
      <p className="mb-0 text-xs text-(--color-text-muted)">변경 사항은 자동으로 저장돼요.</p>
    </fieldset>
  )
}
