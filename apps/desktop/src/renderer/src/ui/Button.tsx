import type { ReactNode } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import './button.css'

type Variant = 'primary' | 'neutral' | 'ghost' | 'danger'
type Size = 'md' | 'sm'

interface ButtonProps extends Omit<AriaButtonProps, 'className' | 'children' | 'style'> {
  variant?: Variant
  size?: Size
  /** E2E용 data-testid */
  testId?: string
  children: ReactNode
}

export function Button({ variant = 'neutral', size = 'md', testId, children, ...rest }: ButtonProps) {
  // data-* 속성은 컴포넌트 props 타입에 없으므로 스프레드로 전달한다
  const testProps = testId ? { 'data-testid': testId } : {}
  return (
    <AriaButton {...rest} {...testProps} className={`ui-button ui-button--${variant} ui-button--${size}`}>
      {children}
    </AriaButton>
  )
}
