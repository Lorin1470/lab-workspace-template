import { FlaskConical, Github, LogOut, ChevronRight, FolderGit2, Bot, Sun, Moon } from 'lucide-react';
import { AuthUser, Course, Experiment } from '../types/index.ts';
import { useTheme } from '../context/ThemeContext.tsx';

interface NavbarProps {
  currentCourse: Course | null;
  currentExperiment: Experiment | null;
  currentView?: string;
  onNavigateHome: () => void;
  onNavigateCourse: (course: Course) => void;
  onNavigateSkillDownload?: () => void;
  user: AuthUser | null;
  onLogout: () => void;
}

import { resolveNavbarRepository } from '../utils/workspace-ui.ts';
export { resolveNavbarRepository };

export const Navbar: React.FC<NavbarProps> = ({
  currentCourse,
  currentExperiment,
  currentView,
  onNavigateHome,
  onNavigateCourse,
  onNavigateSkillDownload,
  user,
  onLogout,
}) => {
  const displayRepo = resolveNavbarRepository(currentExperiment, currentCourse);
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-50 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo 與導覽麵包屑 */}
        <div className="flex items-center space-x-3 overflow-hidden">
          <div
            className="flex items-center space-x-2.5 cursor-pointer shrink-0"
            onClick={onNavigateHome}
          >
            <div className="bg-blue-600 text-white p-2 rounded-lg shadow-xs">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div className="hidden sm:block">
              <h1 className="font-bold text-base text-slate-900 dark:text-white tracking-tight leading-tight">
                實驗課 GitHub 工作區
              </h1>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-none">
                實驗課雲端工作區協作體系
              </p>
            </div>
          </div>

          {/* 麵包屑 Breadcrumbs */}
          {(currentCourse || currentExperiment) ? (
            <div className="flex items-center space-x-1.5 text-xs text-slate-400 dark:text-slate-500 pl-2 border-l border-slate-200 dark:border-slate-700 truncate">
              <button
                onClick={onNavigateHome}
                className="hover:text-blue-600 dark:hover:text-blue-400 font-medium text-slate-600 dark:text-slate-300 transition-colors cursor-pointer shrink-0"
              >
                課程列表
              </button>

              {currentCourse && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  <button
                    onClick={() => onNavigateCourse(currentCourse)}
                    className={`font-semibold transition-colors truncate cursor-pointer ${
                      currentExperiment
                        ? 'text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400'
                        : 'text-slate-900 dark:text-white font-bold'
                    }`}
                  >
                    {currentCourse.course_code} {currentCourse.name}
                  </button>
                </>
              )}

              {currentExperiment && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-slate-900 dark:text-white font-bold truncate">
                    {currentExperiment.experiment_code}
                  </span>
                </>
              )}
            </div>
          ) : currentView === 'skill-download' ? (
            <div className="flex items-center space-x-1.5 text-xs text-slate-400 dark:text-slate-500 pl-2 border-l border-slate-200 dark:border-slate-700 truncate">
              <button
                onClick={onNavigateHome}
                className="hover:text-blue-600 dark:hover:text-blue-400 font-medium text-slate-600 dark:text-slate-300 transition-colors cursor-pointer shrink-0"
              >
                課程列表
              </button>
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              <span className="text-slate-900 dark:text-white font-bold truncate">
                下載 Agent Skill
              </span>
            </div>
          ) : null}
        </div>

        {/* 右側操作與身分資訊 */}
        <div className="flex items-center space-x-3 shrink-0">
          {onNavigateSkillDownload && (
            <button
              onClick={onNavigateSkillDownload}
              className={`inline-flex items-center space-x-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
                currentView === 'skill-download'
                  ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-700'
                  : 'text-slate-600 dark:text-slate-300 hover:text-purple-700 dark:hover:text-purple-300 bg-slate-50 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-950/40 border border-slate-200 dark:border-slate-700 hover:border-purple-200 dark:hover:border-purple-800'
              }`}
              title="下載 github-workspace Agent Skill"
            >
              <Bot className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              <span className="hidden sm:inline">下載 Skill</span>
            </button>
          )}

          {/* 主題切換按鈕 */}
          <button
            type="button"
            onClick={toggleTheme}
            className="p-1.5 rounded-lg border transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            title={theme === 'dark' ? '切換淺色模式' : '切換深色模式'}
            aria-label={theme === 'dark' ? '切換淺色模式' : '切換深色模式'}
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-600" />
            )}
          </button>

          {displayRepo && (
            <span className="hidden md:inline-flex items-center space-x-1 text-xs font-mono bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              <FolderGit2 className="w-3.5 h-3.5 text-slate-400" />
              <span>{displayRepo}</span>
            </span>
          )}

          {/* GitHub 身分驗證狀態 */}
          {user ? (
            <div className="flex items-center space-x-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.username}
                  className="w-6 h-6 rounded-full border border-slate-300 dark:border-slate-600"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-xs">
                  {user.username[0]?.toUpperCase()}
                </div>
              )}
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 hidden sm:inline-block">
                {user.display_name || user.username}
              </span>
              <button
                onClick={onLogout}
                className="flex items-center space-x-1 text-xs text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 p-1 rounded transition-colors cursor-pointer"
                title="登出"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">登出</span>
              </button>
            </div>
          ) : (
            <a
              href="/api/auth/login"
              className="flex items-center space-x-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white border dark:border-slate-700 px-3 py-2 rounded-lg transition-colors"
            >
              <Github className="w-4 h-4" />
              <span>GitHub 登入</span>
            </a>
          )}
        </div>
      </div>
    </header>
  );
};
