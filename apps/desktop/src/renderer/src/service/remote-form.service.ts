function get(draft: { name: string; url: string }): string | null {
  if (!draft.name.trim()) return '원격 이름을 입력해 주세요.'
  if (/\s|[\x00-\x1f]/.test(draft.name)) return '원격 이름에는 공백을 사용할 수 없어요.'
  if (!draft.url.trim()) return '원격 주소를 입력해 주세요.'
  if (/[\x00-\x1f]/.test(draft.url)) return '주소의 줄바꿈을 제거해 주세요.'
  return null
}
export const remoteFormPolicy = { validation: { get } }
