import { MotionConfig } from 'motion/react'
import { ArticleLayout } from './components/layout/ArticleLayout'

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ArticleLayout>
        <header className="mx-auto max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-border bg-brand-soft px-3 py-1 font-mono text-xs font-medium text-brand">
            Post-Quantum Cryptography · Interactive Explainer &amp; Lab
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl sm:leading-[1.08]">
            Attacking Learning With Errors via{' '}
            <span className="text-brand">QUBO Optimization</span>
          </h1>

          <p className="article-prose mt-5">
            An interactive visual walkthrough of reducing simplified binary LWE
            instances to Quadratic Unconstrained Binary Optimization, followed
            by a live solver and benchmarking lab.
          </p>
        </header>
      </ArticleLayout>
    </MotionConfig>
  )
}

export default App
