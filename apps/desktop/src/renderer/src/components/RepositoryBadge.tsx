import { GitBranch } from 'lucide-react'
import type { WorkspaceRepository } from '@git-gui/ipc-contract'
import './repository-badge.css'

interface RepositoryBadgeProps {
  repository: WorkspaceRepository
  current?: boolean
}

/** 통합 목록에서 항목의 Git 저장소 출처를 같은 모양으로 표시한다. */
export function RepositoryBadge({ repository, current = false }: RepositoryBadgeProps) {
  return (
    <span
      className={`repository-badge${current ? ' repository-badge--current' : ''}`}
      title={repository.relativePath}
      data-testid={`repository-badge-${repository.relativePath}`}
    >
      <GitBranch size={10} aria-hidden="true" />
      <span>{repository.name}</span>
    </span>
  )
}
