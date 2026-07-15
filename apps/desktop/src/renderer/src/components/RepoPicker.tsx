interface RepoPickerProps {
  onOpen(): void
  error: string | null
}

export function RepoPicker({ onOpen, error }: RepoPickerProps) {
  return (
    <div className="repo-picker">
      <h1>Git GUI</h1>
      <button type="button" onClick={onOpen}>
        저장소 열기
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
