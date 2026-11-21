import type { Config, Data, Layout } from 'plotly.js-dist-min'
import Plotly from 'plotly.js-dist-min'
import { useEffect, useRef } from 'react'
import { cn } from '../../lib/cn'

interface PlotlyChartProps {
  data: Data[]
  layout?: Partial<Layout>
  config?: Partial<Config>
  className?: string
}

/**
 * Lightweight React 19 + Vite 8 wrapper around plotly.js-dist-min.
 * Uses Plotly.react for efficient updates and ResizeObserver for fluid layouts.
 */
export function PlotlyChart({
  data,
  layout,
  config,
  className,
}: PlotlyChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const mergedConfig: Partial<Config> = {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: [
        'select2d',
        'lasso2d',
        'autoScale2d',
        'hoverClosestCartesian',
        'hoverCompareCartesian',
      ],
      ...config,
    }

    const mergedLayout: Partial<Layout> = {
      autosize: true,
      ...layout,
    }

    void Plotly.react(el, data, mergedLayout, mergedConfig)

    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        Plotly.Plots.resize(containerRef.current)
      }
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
    }
  }, [data, layout, config])

  useEffect(() => {
    const el = containerRef.current
    return () => {
      if (el) {
        Plotly.purge(el)
      }
    }
  }, [])

  return <div ref={containerRef} className={cn('w-full', className)} />
}
