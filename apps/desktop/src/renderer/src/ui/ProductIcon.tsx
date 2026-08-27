import iconUrl from '../assets/yeoul-icon.png'
import './product-icon.css'

interface ProductIconProps {
  size?: number
  label?: string
}

/** 패키지·Dock과 같은 원본 앱 아이콘을 화면 안에 표시한다. */
export function ProductIcon({ size = 48, label }: ProductIconProps) {
  return (
    <img
      className="product-icon"
      src={iconUrl}
      width={size}
      height={size}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
    />
  )
}
