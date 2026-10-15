import React, { useState } from 'react';
import { Course, AuthUser } from '../types/index.ts';
import { api, ApiError } from '../api/client.ts';
import {
  BookOpen,
  Search,
  ChevronRight,
  Archive,
  EyeOff,
  FolderGit2,
  Lock,
  RefreshCw,
  Plus,
  AlertCircle,
} from 'lucide-react';

interface CourseListProps {
  courses: Course[];
  user: AuthUser | null;
  loading: boolean;
  onRefresh: () => void;
  onSelectCourse: (course: Course) => void;
  onSuccess?: (msg: string) => void;
  onError?: (msg: string) => void;
}

export const CourseList: React.FC<CourseListProps> = ({
  courses,
  user,
  loading,
  onRefresh,
  onSelectCourse,
  onSuccess,
  onError,
}) => {

  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 建立課程表單狀態
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newSemester, setNewSemester] = useState('');
  const [newMode, setNewMode] = useState<'course' | 'experiment'>('course');
  const [newGithubRepo, setNewGithubRepo] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setFormError('您尚未登入，請先使用具備管理權限的 GitHub 帳號登入後再建立課程');
      return;
    }

    if (!newCode.trim() || !newName.trim() || !newSemester.trim()) {
      setFormError('請完整填寫課程代碼、課程名稱與開課學期');
      return;
    }

    if (newMode === 'course') {
      const repoRegex = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
      if (!repoRegex.test(newGithubRepo.trim())) {
        setFormError('課程模式必須指定有效的 GitHub 儲存庫 (格式為 owner/repo)');
        return;
      }
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const created = await api.courses.create({
        course_code: newCode.trim(),
        name: newName.trim(),
        semester: newSemester.trim(),
        mode: newMode,
        github_repository: newMode === 'course' ? newGithubRepo.trim() : undefined,
      });
      if (onSuccess) {
        onSuccess(`課程「${created.name} (${created.course_code})」建立成功！`);
      }
      setIsCreateOpen(false);
      setNewCode('');
      setNewName('');
      setNewSemester('');
      setNewMode('course');
      setNewGithubRepo('');
      onRefresh();
      onSelectCourse(created);
    } catch (err: any) {
      let msg = '建立課程失敗，請稍後再試';
      if (err instanceof ApiError && err.status === 409) {
        msg = '衝突：此學期已存在相同課程代碼的課程 (409 Conflict)';
      } else if (err instanceof ApiError && err.status === 403) {
        msg = '權限不足：僅授權之教師或系統管理員可建立課程 (403 Forbidden)';
      } else if (err instanceof ApiError && err.status === 401) {
        msg = '登入失效：請重新使用 GitHub 帳號登入 (401 Unauthorized)';
      } else if (err?.message) {
        msg = err.message;
      }
      setFormError(msg);
      if (onError) {
        onError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

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
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>進行中</span>
          </span>
        );
      case 'archived':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <Archive className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            <span>已封存 (唯讀)</span>
          </span>
        );
      case 'inactive':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
            <EyeOff className="w-3 h-3 text-slate-500 dark:text-slate-400" />
            <span>已停用</span>
          </span>
        );
      default:
        return null;
    }
  };

  const getRoleBadge = (role?: string) => {
    return role ? (
      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
        協作者
      </span>
    ) : null;
  };

  return (
    <div className="space-y-6">
      {/* 標題與操作列 */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4 transition-colors">
        <div>
          <div className="inline-flex items-center space-x-2 text-blue-600 dark:text-blue-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <FolderGit2 className="w-4 h-4" />
            <span>學生實驗工作區</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">我的實驗課程</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {user ? (
              <>
                已登入為 <span className="font-semibold text-slate-700 dark:text-slate-200">@{user.username}</span>，顯示您已加入的實驗課程與專屬工作空間。
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
            className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            title="重新整理"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => {
              setFormError(null);
              setIsCreateOpen(true);
            }}
            className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors cursor-pointer shadow-sm shrink-0"
            title="新增課程"
          >
            <Plus className="w-4 h-4" />
            <span>新增課程</span>
          </button>
        </div>
      </div>

      {/* 未登入提醒卡片 */}
      {!user && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-800/80 border border-blue-200 dark:border-blue-900/50 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors">
          <div className="flex items-start space-x-3">
            <div className="bg-blue-600 text-white p-2.5 rounded-lg mt-0.5 shadow-xs">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-slate-900 dark:text-white">使用 GitHub 帳號登入</h4>
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">
                登入後系統將載入您參與的實驗課程與專屬工作區，與同學共同管理專案與實驗報告。
              </p>
            </div>
          </div>
          <a
            href={api.auth.loginUrl}
            className="inline-flex items-center justify-center space-x-2 bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors shrink-0"
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
            className="w-full pl-9 pr-4 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 rounded-lg focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
          />
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
          顯示 {filteredCourses.length} / {courses.length} 門課程
        </div>
      </div>

      {/* 載入中骨架 */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4 animate-pulse">
              <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-1/3"></div>
              <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
              <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-between">
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
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
              className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 hover:shadow-md hover:border-blue-400 dark:hover:border-blue-500 transition-all cursor-pointer flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-mono">
                      {c.course_code}
                    </span>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 font-mono">
                      {c.semester}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    {getStatusBadge(c.status)}
                    {getRoleBadge(c.role)}
                  </div>
                </div>

                <h3 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {c.name}
                </h3>

                <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                  課程識別碼：<span className="font-mono">{c.id}</span>
                </p>

                {c.mode === 'course' && c.github_repository && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 font-mono mt-1 flex items-center space-x-1 truncate">
                    <FolderGit2 className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{c.github_repository}</span>
                  </p>
                )}
              </div>

              <div className="mt-6 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs text-blue-600 dark:text-blue-400 font-semibold">
                <span>進入課程工作區</span>
                <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 空資料狀態 */}
      {!loading && filteredCourses.length === 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 py-16 text-center space-y-3">
          <BookOpen className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600" />
          <h4 className="text-base font-semibold text-slate-700 dark:text-slate-200">
            {searchTerm ? '找不到符合條件的課程' : '目前尚無可存取的課程'}
          </h4>
          <p className="text-sm text-slate-400 dark:text-slate-400 max-w-sm mx-auto">
            {searchTerm
              ? '請嘗試使用其他關鍵字或清除搜尋條件。'
              : user
              ? '您尚未加入任何實驗課程。若您是授課教師或管理員，可點擊下方按鈕建立新課程；若為學生，請聯絡授課教師/助教將您加入名單。'
              : '請先透過右上角或上方按鈕使用 GitHub 登入以檢視個人課程。'}
          </p>
          {!searchTerm && (
            <button
              onClick={() => {
                setFormError(null);
                setIsCreateOpen(true);
              }}
              className="mt-2 inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新增課程</span>
            </button>
          )}
        </div>
      )}

      {/* 建立課程 Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl max-w-md w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <div className="flex items-center space-x-2">
                <div className="bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 p-1.5 rounded-lg">
                  <BookOpen className="w-4 h-4" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">建立新實驗課程</h3>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-semibold p-1 cursor-pointer"
                title="關閉"
              >
                ✕
              </button>
            </div>

            {!user && (
              <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between">
                <span>注意：您尚未登入。建立課程需先以授權帳號登入。</span>
                <a
                  href={api.auth.loginUrl}
                  className="inline-flex items-center space-x-1 font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0 ml-2"
                >
                  <span>前往登入</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

            {formError && (
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg p-3 text-xs text-red-700 dark:text-red-300 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateCourse} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  課程代碼 (Course Code) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：EE201 或 PHY101"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:bg-white dark:focus:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-mono"
                  required
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">簡短英數字識別碼</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  課程完整名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：電子學實驗（一）"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:bg-white dark:focus:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  開課學期 (Semester) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：114-1 或 2026-Fall"
                  value={newSemester}
                  onChange={(e) => setNewSemester(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:bg-white dark:focus:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-mono"
                  required
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                  課程代碼與學期組合必須唯一 (UNIQUE)
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  儲存庫架構模式 (Repository Mode) <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className={`flex flex-col p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${newMode === 'course' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40 text-slate-700 dark:text-slate-300'}`}>
                    <div className="flex items-center space-x-1.5 font-semibold">
                      <input
                        type="radio"
                        name="course_mode"
                        value="course"
                        checked={newMode === 'course'}
                        onChange={() => setNewMode('course')}
                        className="text-blue-600"
                      />
                      <span>課程模式 (預設)</span>
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">全課共用單一 Repo，各實驗以目錄隔離</span>
                  </label>
                  <label className={`flex flex-col p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${newMode === 'experiment' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40 text-slate-700 dark:text-slate-300'}`}>
                    <div className="flex items-center space-x-1.5 font-semibold">
                      <input
                        type="radio"
                        name="course_mode"
                        value="experiment"
                        checked={newMode === 'experiment'}
                        onChange={() => setNewMode('experiment')}
                        className="text-blue-600"
                      />
                      <span>實驗模式 (相容)</span>
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">各實驗各自綁定獨立 Repo</span>
                  </label>
                </div>
              </div>

              {newMode === 'course' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    GitHub 儲存庫 (owner/repo) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="例如：your-org/electronics-lab"
                    value={newGithubRepo}
                    onChange={(e) => setNewGithubRepo(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:bg-white dark:focus:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-mono"
                    required
                  />
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                    課程模式專用 GitHub 儲存庫。全體實驗將共用此儲存庫，系統會為每個實驗建立專屬工作空間。
                  </p>
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer shadow-sm disabled:opacity-50 flex items-center space-x-1.5"
                >
                  {submitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{submitting ? '建立中...' : '確認建立'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
