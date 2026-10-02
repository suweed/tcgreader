import { createContext, useContext, useEffect, useState } from 'react'

interface SettingsContextType {
  usdToMxn: number
  setUsdToMxn: (v: number) => void
  theme: 'dark' | 'light'
  setTheme: (t: 'dark' | 'light') => void
}

const SettingsContext = createContext<SettingsContextType>({
  usdToMxn: 17.5,
  setUsdToMxn: () => {},
  theme: 'dark',
  setTheme: () => {},
})

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [usdToMxn, setUsdToMxnState] = useState<number>(() => {
    const saved = localStorage.getItem('usdToMxn')
    return saved ? parseFloat(saved) : 17.5
  })

  const [theme, setThemeState] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') ?? 'dark'
  })

  function setUsdToMxn(v: number) {
    setUsdToMxnState(v)
    localStorage.setItem('usdToMxn', String(v))
  }

  function setTheme(t: 'dark' | 'light') {
    setThemeState(t)
    localStorage.setItem('theme', t)
  }

  useEffect(() => {
    const html = document.documentElement
    if (theme === 'light') {
      html.classList.add('light')
    } else {
      html.classList.remove('light')
    }
  }, [theme])

  return (
    <SettingsContext.Provider value={{ usdToMxn, setUsdToMxn, theme, setTheme }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}
