import katex from 'katex'
import { useMemo } from 'react'
import { cn } from '../../lib/cn'

interface MathExprProps {
  tex: string
  display?: boolean
  className?: string
}

/**
 * Renders LaTeX equations synchronously with KaTeX so formulas match
 * editorial prose without client-side layout jumps.
 */
export function MathExpr({ tex, display = false, className }: MathExprProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        strict: false,
      })
    } catch {
      return tex
    }
  }, [tex, display])

  if (display) {
    return (
      <div
        className={cn('my-4 overflow-x-auto text-ink', className)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <span
      className={cn('text-ink', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
