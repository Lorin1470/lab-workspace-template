import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { CourseList } from './components/CourseList.tsx';
import { CourseDetail } from './components/CourseDetail.tsx';
import { ExperimentDetail } from './components/ExperimentDetail.tsx';
import { SkillDownloadPage } from './components/SkillDownloadPage.tsx';
import { Course, Experiment, AuthUser } from './types/index.ts';
import { api, ApiError } from './api/client.ts';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { ThemeProvider } from './context/ThemeContext.tsx';

type ViewMode = 'courses' | 'course-detail' | 'experiment-detail' | 'skill-download';

const getInitialView = (): ViewMode => {
  if (typeof window !== 'undefined' && window.location.pathname === '/skill-download') {
    return 'skill-download';
  }
  return 'courses';
};

const AppContent: React.FC = () => {
  const [view, setView] = useState<ViewMode>(getInitialView);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState<boolean>(true);

  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment | null>(null);
  const [experimentInitialTab, setExperimentInitialTab] = useState<
    'activity' | 'members' | 'repository' | 'report' | 'files' | 'download'
  >('files');

  // 全域通知 Toast
  const [toastSuccess, setToastSuccess] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setToastSuccess(msg);
    setTimeout(() => setToastSuccess((prev) => (prev === msg ? null : prev)), 4000);
  };

  const showError = (msg: string) => {
    setToastError(msg);
    setTimeout(() => setToastError((prev) => (prev === msg ? null : prev)), 5000);
  };

  // 1. 取得登入身分
  const checkAuth = useCallback(async () => {
    try {
      const res = await api.auth.me();
      if (res.authenticated && res.user) {
        setUser(res.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, []);

  // 2. 取得課程列表
  const loadCourses = useCallback(async () => {
    setCoursesLoading(true);
    try {
      const list = await api.courses.list();
      setCourses(list);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) {
        // 未登入狀態，課程清單設為空
        setCourses([]);
      } else {
        showError(err.message || '讀取課程列表失敗');
      }
    } finally {
      setCoursesLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
    loadCourses();
  }, [checkAuth, loadCourses]);

  // 路由導覽輔助（整合原生 History API）
  const navigateTo = useCallback((newView: ViewMode, path: string = '/') => {
    setView(newView);
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
  }, []);

  // 監聽瀏覽器上一頁 / 下一頁 (popstate)
  useEffect(() => {
    const handlePopState = () => {
      if (typeof window !== 'undefined') {
        if (window.location.pathname === '/skill-download') {
          setView('skill-download');
        } else if (window.location.pathname === '/' || window.location.pathname === '') {
          setView('courses');
          setSelectedCourse(null);
          setSelectedExperiment(null);
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleNavigateHome = useCallback(() => {
    setSelectedCourse(null);
    setSelectedExperiment(null);
    navigateTo('courses', '/');
    loadCourses();
  }, [navigateTo, loadCourses]);

  const handleNavigateSkillDownload = useCallback(() => {
    setSelectedCourse(null);
    setSelectedExperiment(null);
    navigateTo('skill-download', '/skill-download');
  }, [navigateTo]);

  // 登出
  const handleLogout = async () => {
    try {
      await api.auth.logout();
      showSuccess('已成功登出系統');
    } catch {
      // ignore
    } finally {
      setUser(null);
      handleNavigateHome();
    }
  };

  // 導覽至課程詳情
  const handleSelectCourse = async (course: Course) => {
    try {
      const latest = await api.courses.get(course.id);
      setSelectedCourse(latest);
      setSelectedExperiment(null);
      setView('course-detail');
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 404) {
        showError('課程不存在或存取被拒 (404)');
      } else {
        showError(err.message || '讀取課程詳情失敗');
      }
    }
  };

  // 導覽至實驗詳情
  const handleSelectExperiment = async (
    exp: Experiment,
    initialTab?: 'activity' | 'members' | 'repository' | 'report' | 'files' | 'download'
  ) => {
    try {
      const data = await api.experiments.get(exp.id);
      setSelectedExperiment(data.experiment);
      if (data.course) {
        setSelectedCourse(data.course);
      }
      if (initialTab) {
        setExperimentInitialTab(initialTab);
      }
      setView('experiment-detail');
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 404) {
        showError('實驗專案不存在或存取被拒 (404)');
      } else {
        showError(err.message || '讀取實驗詳情失敗');
      }
    }
  };

  // 當課程資訊更新時同步
  const handleCourseUpdated = (updated: Course) => {
    setSelectedCourse(updated);
    setCourses((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  // 當實驗資訊更新時同步
  const handleExperimentUpdated = (updated: Experiment) => {
    setSelectedExperiment(updated);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* 頂部導覽列 */}
      <Navbar
        currentCourse={selectedCourse}
        currentExperiment={selectedExperiment}
        currentView={view}
        onNavigateHome={handleNavigateHome}
        onNavigateCourse={(c) => {
          setSelectedExperiment(null);
          setSelectedCourse(c);
          setView('course-detail');
        }}
        onNavigateSkillDownload={handleNavigateSkillDownload}
        user={user}
        onLogout={handleLogout}
      />

      {/* 懸浮 Toast 提示 */}
      <div className="fixed top-20 right-5 z-50 flex flex-col space-y-2 pointer-events-none">
        {toastSuccess && (
          <div className="pointer-events-auto bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center space-x-2 text-xs font-semibold animate-in slide-in-from-top-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{toastSuccess}</span>
            <button
              onClick={() => setToastSuccess(null)}
              className="ml-2 hover:bg-emerald-700 p-0.5 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {toastError && (
          <div className="pointer-events-auto bg-red-600 text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center space-x-2 text-xs font-semibold animate-in slide-in-from-top-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{toastError}</span>
            <button
              onClick={() => setToastError(null)}
              className="ml-2 hover:bg-red-700 p-0.5 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* 主體畫面 */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {view === 'courses' && (
          <CourseList
            courses={courses}
            user={user}
            loading={coursesLoading}
            onRefresh={loadCourses}
            onSelectCourse={handleSelectCourse}
            onSuccess={showSuccess}
            onError={showError}
          />
        )}

        {view === 'skill-download' && (
          <SkillDownloadPage
            onBack={handleNavigateHome}
            onError={showError}
            onSuccess={showSuccess}
          />
        )}

        {view === 'course-detail' && selectedCourse && (
          <CourseDetail
            course={selectedCourse}
            user={user}
            onBack={handleNavigateHome}
            onSelectExperiment={handleSelectExperiment}
            onCourseUpdated={handleCourseUpdated}
            onError={showError}
            onSuccess={showSuccess}
          />
        )}

        {view === 'experiment-detail' && selectedExperiment && (
          <ExperimentDetail
            experiment={selectedExperiment}
            course={selectedCourse}
            userRole={selectedCourse?.role}
            user={user}
            initialTab={experimentInitialTab}
            onBack={() => {
              if (selectedCourse) {
                setSelectedExperiment(null);
                setView('course-detail');
              } else {
                handleNavigateHome();
              }
            }}
            onSelectExperiment={handleSelectExperiment}
            onExperimentUpdated={handleExperimentUpdated}
            onNavigateSkillDownload={handleNavigateSkillDownload}
            onError={showError}
            onSuccess={showSuccess}
          />
        )}
      </main>

      {/* 頁尾 */}
      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-6 text-center text-xs text-slate-400 dark:text-slate-500 transition-colors">
        <p>實驗課 GitHub 工作區系統 • 實驗課雲端工作區協作體系 • Powered by Cloudflare Pages & D1</p>
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
};

export default App;
