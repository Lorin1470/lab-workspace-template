import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const THEME_STORAGE_KEY = 'theme';

export const getStoredTheme = (): Theme | null => {
  if (typeof window === 'undefined') return null;
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === 'light' || val === 'dark') {
      return val;
    }
  } catch {
    // localStorage 可能被阻擋 (如隱私無痕模式或安全限制)
  }
  return null;
};

export const getSystemTheme = (): Theme => {
  if (typeof window === 'undefined') return 'light';
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // matchMedia 不支援時預設淺色
  }
  return 'light';
};

export const applyThemeToDocument = (theme: Theme) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = getStoredTheme();
    if (stored) return stored;
    return getSystemTheme();
  });

  // 套用樣式至 <html> 並持久化至 localStorage
  const applyAndPersist = useCallback((newTheme: Theme, persist = true) => {
    setThemeState(newTheme);
    applyThemeToDocument(newTheme);
    if (persist && typeof window !== 'undefined') {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      } catch {
        // 忽略 localStorage 寫入錯誤
      }
    }
  }, []);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      applyAndPersist(newTheme, true);
    },
    [applyAndPersist]
  );

  const toggleTheme = useCallback(() => {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    applyAndPersist(nextTheme, true);
  }, [theme, applyAndPersist]);

  // 初始化時確認 class 已同步
  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // 當使用者未手動設定偏好時，動態跟隨系統深淺色主題切換
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = (e: MediaQueryListEvent) => {
      const stored = getStoredTheme();
      // 只有在使用者未明確儲存偏好時，才自動跟隨系統偏好
      if (!stored) {
        const sysTheme: Theme = e.matches ? 'dark' : 'light';
        setThemeState(sysTheme);
        applyThemeToDocument(sysTheme);
      }
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleSystemChange);
      return () => mediaQuery.removeEventListener('change', handleSystemChange);
    } else if ((mediaQuery as any).addListener) {
      // 舊版瀏覽器相容性
      (mediaQuery as any).addListener(handleSystemChange);
      return () => (mediaQuery as any).removeListener(handleSystemChange);
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
