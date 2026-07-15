import { FolderOpen } from 'lucide-react'
import { Button } from '../ui/Button'
import { Pictogram } from '../ui/Pictogram'
import './repo-picker.css'

interface RepoPickerProps {
  onOpen(): void
  error: string | null
}

export function RepoPicker({ onOpen, error }: RepoPickerProps) {
  return (
    <div className="repo-picker">
      <div className="repo-picker__card">
        <div className="repo-picker__marks" aria-hidden="true">
          <Pictogram kind="commit" size={20} />
          <Pictogram kind="branch" size={20} />
          <Pictogram kind="shelf" size={20} />
        </div>
        <h1>Git GUI</h1>
        <p>
          프로젝트 폴더를 열면 바뀐 파일을 확인하고
          <br />
          안전하게 저장할 수 있어요.
        </p>
        <Button variant="primary" onPress={onOpen} testId="open-repo">
          <FolderOpen size={16} aria-hidden="true" /> 저장소 열기
        </Button>
        {error && (
          <p className="repo-picker__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
