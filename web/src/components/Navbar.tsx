import React from 'react';
import { FlaskConical, Github, BookOpen, LogOut } from 'lucide-react';
import { AuthUser } from '../types/index.ts';

interface NavbarProps {
  currentCourse: string;
  onSelectCourse: (course: string) => void;
  availableCourses: string[];
  activeRepo: string | null;
  onBackToHome: () => void;
  user: AuthUser | null;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentCourse,
  onSelectCourse,
  availableCourses,
  activeRepo,
  onBackToHome,
  user,
  onLogout,
}) => {
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={onBackToHome}>
          <div className="bg-blue-600 text-white p-2 rounded-lg shadow-sm">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-slate-900 tracking-tight">實驗課 GitHub 工作區</h1>
            <p className="text-xs text-slate-500 font-medium">一節課一 Repo 實驗協作系統</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {activeRepo && (
            <span className="hidden sm:inline-block text-xs font-mono bg-slate-100 px-2.5 py-1 rounded text-slate-600 border border-slate-200">
              {activeRepo}
            </span>
          )}

          {/* 課程選擇器 */}
          <div className="flex items-center space-x-2 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 text-sm">
            <BookOpen className="w-4 h-4 text-slate-500" />
            <select
              value={currentCourse}
              onChange={(e) => onSelectCourse(e.target.value)}
              className="bg-transparent font-medium text-slate-800 focus:outline-none cursor-pointer"
            >
              {availableCourses.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* GitHub 身分驗證狀態 */}
          {user ? (
            <div className="flex items-center space-x-2.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
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
                <span className="hidden md:inline">登出</span>
              </button>
            </div>
          ) : (
            <a
              href="/api/auth/login"
              className="flex items-center space-x-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-lg transition-colors"
            >
              <Github className="w-4 h-4" />
              <span>使用 GitHub 登入</span>
            </a>
          )}
        </div>
      </div>
    </header>
  );
};
