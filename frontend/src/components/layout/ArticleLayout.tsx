import { FlaskConical, Moon, Sun } from 'lucide-react'
import { motion, useScroll, useSpring } from 'motion/react'
import type { ReactNode } from 'react'
import { useTheme } from '../../hooks/useTheme'

interface ArticleLayoutProps {
  children: ReactNode
}

/**
 * Single-page scrolling editorial shell for the LWE -> QUBO interactive article
 * and bottom Attack Lab workbench.
 */
export function ArticleLayout({ children }: ArticleLayoutProps) {
  const { isDark, toggleDark } = useTheme()
  const { scrollYProgress } = useScroll()
  const readingProgress = useSpring(scrollYProgress, {
    stiffness: 260,
    damping: 32,
    restDelta: 0.001,
  })

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-page/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white shadow-xs dark:text-page">
              <FlaskConical className="h-4 w-4" />
            </div>
            <span className="font-display text-sm font-bold tracking-tight text-ink">
              LWE → QUBO Attack Lab
            </span>
          </div>

          <button
            type="button"
            onClick={toggleDark}
            aria-label="Toggle color theme"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-border-strong hover:bg-subtle"
          >
            {isDark ? (
              <>
                <Sun className="h-3.5 w-3.5 text-noise" />
                <span>Light</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5 text-brand" />
                <span>Dark</span>
              </>
            )}
          </button>
        </div>

        {/* Subtle editorial reading progress bar */}
        <motion.div
          style={{ scaleX: readingProgress }}
          className="h-[2px] origin-left bg-brand"
        />
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24 pt-14 sm:px-6 sm:pt-20">
        {children}
      </main>
    </div>
  )
}
