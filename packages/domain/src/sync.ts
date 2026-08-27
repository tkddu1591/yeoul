export interface PushPreview {
  remote: string
  remoteUrl: string
  branch: string
  destination: string
  commitCount: number
  expectedHead: string
  needsConfirmation: boolean
}

export interface PushConfirmation {
  remote: string
  branch: string
  expectedHead: string
}
