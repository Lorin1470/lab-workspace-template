import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { CourseList } from './components/CourseList.tsx';
import { CourseDetail } from './components/CourseDetail.tsx';
import { ExperimentDetail } from './components/ExperimentDetail.tsx';
import { Course, Experiment, AuthUser } from './types/index.ts';
import { api, ApiError } from './api/client.ts';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

type ViewMode = 'courses' | 'course-detail' | 'experiment-detail';

export const App: React.FC = () => {
  const [view, setView] = useState<ViewMode>('courses');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState<boolean>(true);

  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment | null>(null);

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

  // 登出
  const handleLogout = async () => {
    try {
      await api.auth.logout();
      showSuccess('已成功登出系統');
    } catch {
      // ignore
    } finally {
      setUser(null);
      setSelectedCourse(null);
      setSelectedExperiment(null);
      setView('courses');
      loadCourses();
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
  const handleSelectExperiment = async (exp: Experiment) => {
    try {
      const data = await api.experiments.get(exp.id);
      setSelectedExperiment(data.experiment);
      if (data.course) {
        setSelectedCourse(data.course);
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
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* 頂部導覽列 */}
      <Navbar
        currentCourse={selectedCourse}
        currentExperiment={selectedExperiment}
        onNavigateHome={() => {
          setSelectedCourse(null);
          setSelectedExperiment(null);
          setView('courses');
          loadCourses();
        }}
        onNavigateCourse={(c) => {
          setSelectedExperiment(null);
          setSelectedCourse(c);
          setView('course-detail');
        }}
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
            onError={showError}
            onSuccess={showSuccess}
          />
        )}

        {view === 'course-detail' && selectedCourse && (
          <CourseDetail
            course={selectedCourse}
            user={user}
            onBack={() => {
              setSelectedCourse(null);
              setSelectedExperiment(null);
              setView('courses');
              loadCourses();
            }}
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
            onBack={() => {
              if (selectedCourse) {
                setSelectedExperiment(null);
                setView('course-detail');
              } else {
                setSelectedCourse(null);
                setSelectedExperiment(null);
                setView('courses');
                loadCourses();
              }
            }}
            onExperimentUpdated={handleExperimentUpdated}
            onError={showError}
            onSuccess={showSuccess}
          />
        )}
      </main>

      {/* 頁尾 */}
      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        <p>實驗課 GitHub 工作區系統 • 一節課一 Repo 實驗協作體系 • Powered by Cloudflare Pages & D1</p>
      </footer>
    </div>
  );
};

export default App;
