import type { RecentPlacesHistory } from '../adapter/recent-places.adapter'
import { FolderGit2, FolderOpen, GitFork, Pin } from 'lucide-react'
import { useRecentPlaces } from '../hook/use-recent-places'
import { Button } from '../ui/Button'
import { ProductIcon } from '../ui/ProductIcon'

interface RepoPickerProps {
  history: RecentPlacesHistory
  home: string
  error: string | null
  busy: boolean
  onOpen(): void
  onClone(): void
  onInit(): void
  onOpenRecent(path: string): void
}
export function RepoPicker({
  history,
  home,
  error,
  busy,
  onOpen,
  onClone,
  onInit,
  onOpenRecent,
}: RepoPickerProps) {
  const places = useRecentPlaces(history, home)
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-8">
      <section className="w-full max-w-3xl rounded-xl border border-(--color-border) bg-(--color-surface) p-6">
        <div className="mb-5 flex items-center gap-3">
          <ProductIcon size={42} label="여울" />
          <div>
            <h1 className="m-0 text-xl">작업 이어가기</h1>
            <p className="my-1 text-sm text-(--color-text-muted)">
              여러 저장소와 워크트리의 변경을 한곳에서 검토하세요.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" isDisabled={busy} onPress={onOpen} testId="open-repo">
            <FolderOpen size={16} /> 폴더 · 워크스페이스 열기
          </Button>
          <Button variant="neutral" isDisabled={busy} onPress={onClone} testId="clone-repo">
            <GitFork size={16} /> 원격 저장소 복제
          </Button>
          <Button variant="ghost" isDisabled={busy} onPress={onInit} testId="init-repo">
            <FolderGit2 size={16} /> 새 저장소 만들기
          </Button>
        </div>
        <p className="text-xs text-(--color-text-muted)">
          저장소 하나 또는 여러 저장소를 담은 상위 폴더를 선택할 수 있어요. ⌘O로 열기
        </p>
        {(history.paths.length > 0 || places.data.items.length > 0) && (
          <>
            <label className="mt-5 block text-sm">
              최근 작업 검색
              <input
                className="mt-2 block w-full rounded border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
                value={places.data.query}
                onChange={(event) => places.filter.set(event.target.value)}
                placeholder="이름 또는 경로"
              />
            </label>
            <ul
              className="m-0 mt-2 max-h-[45vh] list-none overflow-auto p-0"
              data-testid="repo-picker-recent"
            >
              {places.data.items.map((place) => (
                <li key={place.path} className="flex items-center border-b border-(--color-border)">
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer rounded border-0 bg-transparent text-(--color-text) px-2 py-3 text-left hover:bg-(--color-selection-bg)"
                    disabled={busy}
                    onClick={() => onOpenRecent(place.path)}
                    data-testid={`repo-picker-recent-${place.path}`}
                  >
                    <strong className="block truncate text-sm">
                      {place.name}
                      <span className="ml-2 text-xs font-normal text-(--color-text-muted)">
                        {place.kind}
                      </span>
                    </strong>
                    <span
                      className="block truncate text-xs text-(--color-text-muted)"
                      title={place.path}
                    >
                      {place.label}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${place.name} ${place.pinned ? '고정 해제' : '고정'}`}
                    aria-pressed={place.pinned}
                    onPress={() => places.pin.toggle(place.path)}
                  >
                    <Pin size={14} />
                  </Button>
                </li>
              ))}
            </ul>
            {!places.data.items.length && <p className="text-sm">일치하는 작업이 없어요.</p>}
          </>
        )}
        {error && (
          <p role="alert" className="whitespace-pre-wrap text-sm text-(--color-danger)">
            {error}
          </p>
        )}
      </section>
    </main>
  )
}
