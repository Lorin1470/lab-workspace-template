import React, { useState } from 'react';
import { Course, AuthUser } from '../types/index.ts';
import { api } from '../api/client.ts';
import {
  BookOpen,
  Search,
  ChevronRight,
  Archive,
  EyeOff,
  FolderGit2,
  Lock,
  RefreshCw,
} from 'lucide-react';

interface CourseListProps {
  courses: Course[];
  user: AuthUser | null;
  loading: boolean;
  onRefresh: () => void;
  onSelectCourse: (course: Course) => void;
  onError?: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export const CourseList: React.FC<CourseListProps> = ({
  courses,
  user,
  loading,
  onRefresh,
  onSelectCourse,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCourses = courses.filter((c) => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return (
      c.course_code.toLowerCase().includes(term) ||
      c.name.toLowerCase().includes(term) ||
      c.semester.toLowerCase().includes(term)
    );
  });

  const getStatusBadge = (status: Course['status']) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>進行中</span>
          </span>
        );
      case 'archived':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <Archive className="w-3 h-3 text-amber-600" />
            <span>已封存 (唯讀)</span>
          </span>
        );
      case 'inactive':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-300">
            <EyeOff className="w-3 h-3 text-slate-500" />
            <span>已停用</span>
          </span>
        );
      default:
        return null;
    }
  };

  const getRoleBadge = (role?: string) => {
    return role ? (
      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
        協作者
      </span>
    ) : null;
  };

  return (
    <div className="space-y-6">
      {/* 標題與操作列 */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-2 text-blue-600 text-xs font-semibold uppercase tracking-wider mb-1">
            <FolderGit2 className="w-4 h-4" />
            <span>學生實驗工作區</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">我的實驗課程</h2>
          <p className="text-sm text-slate-500 mt-1">
            {user ? (
              <>
                已登入為 <span className="font-semibold text-slate-700">@{user.username}</span>，顯示您已加入的實驗課程與專屬工作空間。
              </>
            ) : (
              '瀏覽實驗課程索引與各學期實驗工作區。登入後即可檢視您所參與的課程。'
            )}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            title="重新整理"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 未登入提醒卡片 */}
      {!user && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start space-x-3">
            <div className="bg-blue-600 text-white p-2.5 rounded-lg mt-0.5">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-slate-900">使用 GitHub 帳號登入</h4>
              <p className="text-sm text-slate-600 mt-0.5">
                登入後系統將載入您參與的實驗課程與專屬工作區，與同學共同管理專案與實驗報告。
              </p>
            </div>
          </div>
          <a
            href={api.auth.loginUrl}
            className="inline-flex items-center justify-center space-x-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors shrink-0"
          >
            <span>GitHub 登入</span>
            <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      )}

      {/* 搜尋與過濾列 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative max-w-md w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜尋課程代碼、名稱或學期（如 114-1）..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>
        <div className="text-xs text-slate-500 font-medium">
          顯示 {filteredCourses.length} / {courses.length} 門課程
        </div>
      </div>

      {/* 載入中骨架 */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 animate-pulse">
              <div className="h-5 bg-slate-200 rounded w-1/3"></div>
              <div className="h-6 bg-slate-200 rounded w-3/4"></div>
              <div className="h-4 bg-slate-200 rounded w-1/2"></div>
              <div className="pt-4 border-t border-slate-100 flex justify-between">
                <div className="h-4 bg-slate-200 rounded w-1/4"></div>
                <div className="h-4 bg-slate-200 rounded w-1/4"></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 課程卡片網格 */}
      {!loading && filteredCourses.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredCourses.map((c) => (
            <div
              key={c.id}
              onClick={() => onSelectCourse(c)}
              className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md hover:border-blue-400 transition-all cursor-pointer flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-slate-100 text-slate-800 font-mono">
                      {c.course_code}
                    </span>
                    <span className="text-xs font-medium text-slate-500 font-mono">
                      {c.semester}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    {getStatusBadge(c.status)}
                    {getRoleBadge(c.role)}
                  </div>
                </div>

                <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                  {c.name}
                </h3>

                <p className="text-xs text-slate-400 mt-2">
                  課程識別碼：<span className="font-mono">{c.id}</span>
                </p>

                {c.mode === 'course' && c.github_repository && (
                  <p className="text-xs text-slate-600 font-mono mt-1 flex items-center space-x-1 truncate">
                    <FolderGit2 className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{c.github_repository}</span>
                  </p>
                )}
              </div>

              <div className="mt-6 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-blue-600 font-semibold">
                <span>進入課程工作區</span>
                <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 空資料狀態 */}
      {!loading && filteredCourses.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-slate-200 py-16 text-center space-y-3">
          <BookOpen className="w-10 h-10 mx-auto text-slate-300" />
          <h4 className="text-base font-semibold text-slate-700">
            {searchTerm ? '找不到符合條件的課程' : '目前尚無可存取的課程'}
          </h4>
          <p className="text-sm text-slate-400 max-w-sm mx-auto">
            {searchTerm
              ? '請嘗試使用其他關鍵字或清除搜尋條件。'
              : user
              ? '您尚未加入任何實驗課程。若您是本課程學生，請確認已登入正確的 GitHub 帳號，或聯絡授課教師/助教將您加入課程協作者名單。'
              : '請先透過右上角或上方按鈕使用 GitHub 登入以檢視個人課程。'}
          </p>
        </div>
      )}
    </div>
  );
};

