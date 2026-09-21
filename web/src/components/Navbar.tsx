import { FlaskConical, Github, LogOut, ChevronRight, FolderGit2 } from 'lucide-react';
import { AuthUser, Course, Experiment } from '../types/index.ts';

interface NavbarProps {
  currentCourse: Course | null;
  currentExperiment: Experiment | null;
  onNavigateHome: () => void;
  onNavigateCourse: (course: Course) => void;
  user: AuthUser | null;
  onLogout: () => void;
}

import { resolveNavbarRepository } from '../utils/workspace-ui.ts';
export { resolveNavbarRepository };

export const Navbar: React.FC<NavbarProps> = ({
  currentCourse,
  currentExperiment,
  onNavigateHome,
  onNavigateCourse,
  user,
  onLogout,
}) => {
  const displayRepo = resolveNavbarRepository(currentExperiment, currentCourse);

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
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
              <h1 className="font-bold text-base text-slate-900 tracking-tight leading-tight">
                實驗課 GitHub 工作區
              </h1>
              <p className="text-[11px] text-slate-500 font-medium leading-none">
                實驗課雲端工作區協作體系
              </p>
            </div>
          </div>

          {/* 麵包屑 Breadcrumbs */}
          {(currentCourse || currentExperiment) && (
            <div className="flex items-center space-x-1.5 text-xs text-slate-400 pl-2 border-l border-slate-200 truncate">
              <button
                onClick={onNavigateHome}
                className="hover:text-blue-600 font-medium text-slate-600 transition-colors cursor-pointer shrink-0"
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
                        ? 'text-slate-600 hover:text-blue-600'
                        : 'text-slate-900 font-bold'
                    }`}
                  >
                    {currentCourse.course_code} {currentCourse.name}
                  </button>
                </>
              )}

              {currentExperiment && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-slate-900 font-bold truncate">
                    {currentExperiment.experiment_code}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* 右側操作與身分資訊 */}
        <div className="flex items-center space-x-3 shrink-0">
          {displayRepo && (
            <span className="hidden md:inline-flex items-center space-x-1 text-xs font-mono bg-slate-100 px-2.5 py-1 rounded text-slate-600 border border-slate-200">
              <FolderGit2 className="w-3.5 h-3.5 text-slate-400" />
              <span>{displayRepo}</span>
            </span>
          )}

          {/* GitHub 身分驗證狀態 */}
          {user ? (
            <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.username}
                  className="w-6 h-6 rounded-full border border-slate-300"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                  {user.username[0]?.toUpperCase()}
                </div>
              )}
              <span className="text-xs font-semibold text-slate-800 hidden sm:inline-block">
                {user.display_name || user.username}
              </span>
              <button
                onClick={onLogout}
                className="flex items-center space-x-1 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 p-1 rounded transition-colors cursor-pointer"
                title="登出"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">登出</span>
              </button>
            </div>
          ) : (
            <a
              href="/api/auth/login"
              className="flex items-center space-x-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-lg transition-colors"
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
