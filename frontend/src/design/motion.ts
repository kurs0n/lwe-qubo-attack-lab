import type { Transition, Variants } from 'motion/react'

/**
 * Shared Motion physics for interactive diagrams & editorial transitions.
 * Calibrated to feel crisp and mechanical — never floaty or distracting.
 */
export const SPRINGS = {
  /** Tactile spring for bit toggles (0 <-> 1), chips, and matrix cell highlights */
  snappy: {
    type: 'spring',
    stiffness: 520,
    damping: 32,
    mass: 0.7,
  } satisfies Transition,

  /** Smooth spring for segmented tab pills, layout shifts, and equation reorganizations */
  smooth: {
    type: 'spring',
    stiffness: 340,
    damping: 30,
    mass: 0.9,
  } satisfies Transition,

  /** Gentle editorial reveal for figure frames entering viewport */
  editorial: {
    duration: 0.45,
    ease: [0.22, 1, 0.36, 1],
  } satisfies Transition,
} as const

export const FIGURE_REVEAL: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: SPRINGS.editorial,
  },
}

export const STAGGER_CHILDREN: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.05,
    },
  },
}

export const MATRIX_CELL_POP: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: SPRINGS.snappy,
  },
}
