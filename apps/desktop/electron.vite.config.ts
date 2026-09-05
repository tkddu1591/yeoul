import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@git-gui/domain',
          '@git-gui/git-adapter',
          '@git-gui/git-process',
          '@git-gui/hosting',
          '@git-gui/ipc-contract',
        ],
      }),
    ],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@git-gui/domain', '@git-gui/ipc-contract'] })],
  },
  renderer: {
    plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss()],
  },
})
