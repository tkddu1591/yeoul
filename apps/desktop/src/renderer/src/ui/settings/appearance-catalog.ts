import type { ColorMode, ColorTheme } from '@git-gui/ipc-contract'

export const appearanceCatalog = {
  mode: {
    options: [
      { value: 'light', label: '라이트', description: '밝고 또렷하게' },
      { value: 'dark', label: '다크', description: '눈이 편안하게' },
    ] satisfies Array<{ value: ColorMode; label: string; description: string }>,
  },
  theme: {
    options: [
      { value: 'yeoul', label: '여울', description: '물빛 청록과 보랏빛' },
      { value: 'blue', label: '블루', description: '차분하고 선명한 파랑' },
      { value: 'forest', label: '숲', description: '편안한 초록의 결' },
      { value: 'retro', label: '레트로', description: '종이와 호박빛 온기' },
      { value: 'violet', label: '보랏빛', description: '은은하고 깊은 보라' },
    ] satisfies Array<{ value: ColorTheme; label: string; description: string }>,
  },
}
