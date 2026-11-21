import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { FIGURE_REVEAL } from '../../design/motion'
import { cn } from '../../lib/cn'

interface FigureFrameProps {
  figureNumber: string
  title: string
  badge?: string
  caption?: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Editorial breakout figure container modeled after ngrok's interactive essays.
 * Combines a crisp metadata header, subtle dot-grid stage, and figure caption.
 */
export function FigureFrame({
  figureNumber,
  title,
  badge,
  caption,
  toolbar,
  children,
  className,
}: FigureFrameProps) {
  return (
    <motion.figure
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-40px' }}
      variants={FIGURE_REVEAL}
      className={cn('my-10 w-full', className)}
    >
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_32px_-16px_rgba(17,19,24,0.08)] dark:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.55)]">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-subtle/60 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="rounded-md border border-border-subtle bg-surface px-2 py-0.5 font-mono text-xs font-medium text-ink-muted">
              {figureNumber}
            </span>
            <span className="font-display text-sm font-semibold text-ink">
              {title}
            </span>
            {badge && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-0.5 font-mono text-[11px] font-medium text-brand">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                {badge}
              </span>
            )}
          </div>
          {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
        </div>

        {/* Dot-grid interactive canvas */}
        <div className="figure-grid p-5 sm:p-7">{children}</div>
      </div>

      {caption && (
        <figcaption className="mt-3 px-1 text-sm leading-relaxed text-ink-muted">
          {caption}
        </figcaption>
      )}
    </motion.figure>
  )
}
