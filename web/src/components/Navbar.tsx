import React from 'react';
import { FlaskConical, Github, BookOpen } from 'lucide-react';

interface NavbarProps {
  currentCourse: string;
  onSelectCourse: (course: string) => void;
  availableCourses: string[];
  activeRepo: string | null;
  onBackToHome: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentCourse,
  onSelectCourse,
  availableCourses,
  activeRepo,
  onBackToHome,
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

          {/* GitHub 狀態與母倉庫連結 */}
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-lg transition-colors"
          >
            <Github className="w-4 h-4" />
            <span>GitHub 連線中</span>
          </a>
        </div>
      </div>
    </header>
  );
};
