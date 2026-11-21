import { useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'lwe-qubo-theme'

function readInitialDark(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('dark')
}

export function useTheme() {
  const [isDark, setIsDark] = useState<boolean>(readInitialDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light')
  }, [isDark])

  return {
    isDark,
    setIsDark,
    toggleDark: () => setIsDark((prev) => !prev),
  }
}
