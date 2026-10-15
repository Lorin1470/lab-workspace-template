import React, { useState, useEffect } from "react";
import {
  Course,
  Experiment,
  CourseMembership,
  AuthUser,
  ExperimentStatus,
  ActivityLogItem,
} from "../types/index.ts";
import { api } from "../api/client.ts";
import {
  ArrowLeft,
  FlaskConical,
  Users,
  ChevronRight,
  Archive,
  EyeOff,
  RefreshCw,
  FolderGit2,
  ExternalLink,
  Activity,
  Search,
} from "lucide-react";

interface CourseDetailProps {
  course: Course;
  user: AuthUser | null;
  onBack: () => void;
  onSelectExperiment: (exp: Experiment, initialTab?: "activity" | "members" | "repository" | "report" | "files" | "download") => void;
  onCourseUpdated: (updated: Course) => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

type TabType = "experiments" | "members" | "activity";

const expStatusMap: Record<ExperimentStatus, { label: string; badgeClass: string; icon: string }> = {
  not_started: {
    label: "尚未開始",
    badgeClass: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700",
    icon: "⬜",
  },
  in_progress: {
    label: "實驗進行中",
    badgeClass: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800",
    icon: "🟡",
  },
  data_processing: {
    label: "資料整理中",
    badgeClass: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800",
    icon: "🔵",
  },
  report_writing: {
    label: "報告撰寫中",
    badgeClass: "bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-800",
    icon: "🟠",
  },
  completed: {
    label: "已完成",
    badgeClass: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800",
    icon: "🟢",
  },
};

export const CourseDetail: React.FC<CourseDetailProps> = ({
  course,
  user,
  onBack,
  onSelectExperiment,
  onError,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>("experiments");
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [members, setMembers] = useState<CourseMembership[]>([]);
  const [loading, setLoading] = useState(true);

  // 活動紀錄狀態
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityActionFilter, setActivityActionFilter] = useState("");
  const [activitySearchKeyword, setActivitySearchKeyword] = useState("");

  // 載入資料
  const loadData = async () => {
    setLoading(true);
    try {
      const [expList, memList] = await Promise.all([
        api.experiments.listByCourse(course.id).catch(() => []),
        api.courseMembers.list(course.id).catch(() => []),
      ]);
      setExperiments(expList);
      setMembers(memList);
    } catch (err: any) {
      onError(err.message || "載入課程資料失敗");
    } finally {
      setLoading(false);
    }
  };

  const loadActivityLogs = async () => {
    setActivityLoading(true);
    try {
      const res = await api.activity.list(
        undefined,
        undefined,
        50,
        {
          course_id: course.id,
          action: activityActionFilter || undefined,
          search: activitySearchKeyword.trim() || undefined,
        }
      );
      setActivityLogs(res.logs || []);
    } catch (err: any) {
      console.error("Failed to load activity logs:", err);
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    if (activeTab === "activity") loadActivityLogs();
  }, [course.id, activeTab]);

  useEffect(() => {
    if (activeTab === "activity") {
      loadActivityLogs();
    }
  }, [activityActionFilter, activitySearchKeyword]);

  const getStatusBadge = (status: Course["status"]) => {
    switch (status) {
      case "active":
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>進行中</span>
          </span>
        );
      case "archived":
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <Archive className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            <span>已封存 (唯讀)</span>
          </span>
        );
      case "inactive":
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

  const renderProvBadge = (status?: string) => {
    if (status === "ready") {
      return (
        <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.2 rounded">
          就緒
        </span>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* 頂部導覽列 */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm transition-colors">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer mt-1"
              title="返回課程列表"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-mono font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 px-2.5 py-0.5 rounded">
                  {course.course_code}
                </span>
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400 font-semibold">
                  {course.semester}
                </span>
                {getStatusBadge(course.status)}
                {course.role && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                    我的身分：協作者 ({course.role === "student" ? "學生" : course.role})
                  </span>
                )}
              </div>

              <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-1.5">{course.name}</h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                <span>課程 ID：{course.id}</span>
                {course.github_repository && (
                  <>
                    <span>•</span>
                    <a
                      href={`https://github.com/${course.github_repository}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-semibold"
                    >
                      <FolderGit2 className="w-3.5 h-3.5" />
                      <span>{course.github_repository}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3 self-end md:self-auto">
            <button
              onClick={loadData}
              disabled={loading}
              className="p-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 transition-colors cursor-pointer disabled:opacity-50"
              title="重新整理"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* 狀態提示橫幅 */}
        {course.status === "archived" && (
          <div className="mt-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center space-x-2">
            <Archive className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>此課程已封存。所有歷史實驗報告均為唯讀檢視。</span>
          </div>
        )}
        {course.status === "inactive" && (
          <div className="mt-4 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-3 text-xs text-slate-700 dark:text-slate-300 flex items-center space-x-2">
            <EyeOff className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
            <span>此課程目前處於停用隱藏狀態。</span>
          </div>
        )}

        {/* 分頁導覽 */}
        <div className="flex border-b border-slate-200 dark:border-slate-700 mt-6 -mb-6 space-x-1">
          <button
            onClick={() => setActiveTab("experiments")}
            className={`flex items-center space-x-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "experiments"
                ? "border-blue-600 dark:border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600"
            }`}
          >
            <FlaskConical className="w-4 h-4" />
            <span>實驗專案 ({experiments.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("members")}
            className={`flex items-center space-x-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "members"
                ? "border-blue-600 dark:border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>課程成員 ({members.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("activity")}
            className={`flex items-center space-x-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "activity"
                ? "border-blue-600 dark:border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600"
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>活動紀錄</span>
          </button>
        </div>
      </div>

      {/* 分頁一：實驗專案列表 */}
      {activeTab === "experiments" && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {course.mode === "course"
              ? `課程模式：共用儲存庫 ${course.github_repository || ""}，各實驗具備專屬工作空間。點擊實驗進入工作區。`
              : "實驗模式：各實驗專案具備獨立的 Git 工作區。點擊實驗進入工作區。"}
          </p>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-3 animate-pulse">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
                  <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : experiments.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {experiments.map((exp) => {
                const statusInfo = expStatusMap[exp.status] || expStatusMap.not_started;
                return (
                  <div
                    key={exp.id}
                    onClick={() => onSelectExperiment(exp, "files")}
                    className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 hover:shadow-md hover:border-blue-400 dark:hover:border-blue-500 transition-all cursor-pointer flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-mono">
                            {exp.experiment_code}
                          </span>
                          {renderProvBadge(exp.provisioning_status)}
                        </div>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusInfo.badgeClass}`}>
                          {statusInfo.icon} {statusInfo.label}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {exp.name}
                      </h3>

                      <p className="text-xs text-slate-400 dark:text-slate-500 font-mono mt-1 flex items-center space-x-1">
                        <FolderGit2 className="w-3 h-3 shrink-0" />
                        <span className="truncate">
                          {course.mode === "course"
                            ? course.github_repository
                            : (exp.repository || "未綁定")}
                        </span>
                      </p>

                      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded text-[11px] text-slate-600 dark:text-slate-300">
                          {exp.report_mode === "shared" ? "共同報告模式" : "個別報告模式"}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500">Template v{exp.config_version}</span>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs text-blue-600 dark:text-blue-400 font-semibold">
                      <span>開啟實驗工作區</span>
                      <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 py-12 text-center space-y-2">
              <FlaskConical className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">此課程目前尚未建立任何實驗專案</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">目前尚未建立本課程之實驗項目，請待授課教師或助教配置。</p>
            </div>
          )}
        </div>
      )}

      {/* 分頁二：課程成員 (唯讀名單) */}
      {activeTab === "members" && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            本課程已授權協作者名單。所有列名成員均可存取課程資源與所指派之實驗工作區。
          </p>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3">GitHub 使用者</th>
                    <th className="px-5 py-3">不可變 GitHub ID</th>
                    <th className="px-5 py-3">課程角色</th>
                    <th className="px-5 py-3">狀態</th>
                    <th className="px-5 py-3">GitHub 權限</th>
                    <th className="px-5 py-3">加入時間</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {members.map((m) => {
                    const isSelf = user && String(user.github_id) === String(m.github_id);
                    return (
                      <tr key={m.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/40 transition-colors">
                        <td className="px-5 py-3.5 font-medium text-slate-900 dark:text-slate-100 flex items-center space-x-2">
                          <span>@{m.username}</span>
                          {isSelf && (
                            <span className="text-[10px] bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 px-1.5 py-0.2 rounded font-semibold">
                              你自己
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-slate-500 dark:text-slate-400">{m.github_id}</td>
                        <td className="px-5 py-3.5">
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                            {m.role === "teacher" ? "教師" : m.role === "assistant" ? "助教" : "學生"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          {m.status === "active" && (
                            <span className="inline-flex items-center space-x-1 text-xs text-emerald-700 dark:text-emerald-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              <span>正常 (active)</span>
                            </span>
                          )}
                          {m.status === "inactive" && (
                            <span className="inline-flex items-center space-x-1 text-xs text-slate-500 dark:text-slate-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500"></span>
                              <span>停用 (inactive)</span>
                            </span>
                          )}
                          {m.status === "suspended" && (
                            <span className="inline-flex items-center space-x-1 text-xs text-red-600 dark:text-red-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                              <span>停權 (suspended)</span>
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {m.role !== "student" ? (
                            <span className="text-xs text-slate-400 dark:text-slate-500" title="非學生，毋須 GitHub 協作者權限">
                              —
                            </span>
                          ) : m.github_permission_status === "ready" ? (
                            <span
                              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                              title={m.github_synced_at ? `已於 ${m.github_synced_at.slice(0, 19).replace("T", " ")} 同步 push 權限` : "已同步 push 權限"}
                            >
                              <span>✓ 已同步</span>
                            </span>
                          ) : m.github_permission_status === "pending" ? (
                            <span
                              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                              title="正在向 GitHub 同步協作者權限"
                            >
                              <span>待同步</span>
                            </span>
                          ) : m.github_permission_status === "failed" ? (
                            <span
                              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
                              title={m.github_permission_error || "GitHub 協作者同步失敗"}
                            >
                              <span>✗ 同步失敗</span>
                            </span>
                          ) : m.github_permission_status === "removed" ? (
                            <span
                              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600"
                              title="已從 GitHub Repository 協作者名單移除"
                            >
                              <span>— 已移除</span>
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-slate-500">待同步</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-400 dark:text-slate-500">
                          {m.created_at?.slice(0, 10)}
                        </td>
                      </tr>
                    );
                  })}
                  {members.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-slate-400 dark:text-slate-500 text-xs">
                        目前尚無任何成員
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 分頁三：活動紀錄 */}
      {activeTab === "activity" && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs transition-colors">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center space-x-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded-lg">
                <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  placeholder="搜尋摘要或目標..."
                  value={activitySearchKeyword}
                  onChange={(e) => setActivitySearchKeyword(e.target.value)}
                  className="bg-transparent border-none outline-none text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 w-32 md:w-48 text-xs"
                />
              </div>

              <select
                value={activityActionFilter}
                onChange={(e) => setActivityActionFilter(e.target.value)}
                className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 text-xs"
              >
                <option value="">全部動作類型</option>
                <option value="file_created">建立檔案 (file_created)</option>
                <option value="file_modified">更新檔案 (file_modified)</option>
                <option value="file_deleted">刪除檔案 (file_deleted)</option>
                <option value="raw_uploaded">原始數據上傳 (raw_uploaded)</option>
                <option value="photo_uploaded">照片上傳 (photo_uploaded)</option>
              </select>
            </div>

            <button
              onClick={loadActivityLogs}
              disabled={activityLoading}
              className="inline-flex items-center space-x-1 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${activityLoading ? "animate-spin" : ""}`} />
              <span>重新整理</span>
            </button>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-xs transition-colors">
            <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {activityLogs.map((log) => {
                let details: any = null;
                try {
                  if (log.details_json) details = JSON.parse(log.details_json);
                } catch {}

                const isBotDelegated = details?.execution_mode === "bot_delegated";
                const initiator = details?.initiated_by?.username;

                return (
                  <div key={log.id} className="p-4 hover:bg-slate-50/80 dark:hover:bg-slate-700/40 transition-colors space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">@{log.actor_name || log.actor_id}</span>
                        <span className="text-slate-400 dark:text-slate-500">•</span>
                        <span className="font-mono text-slate-500 dark:text-slate-400">{new Date(log.timestamp).toLocaleString()}</span>
                        {isBotDelegated && (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                            <span>🤖 GitHub App Bot 代為執行</span>
                            {initiator && <span>(發起者: @{initiator})</span>}
                          </span>
                        )}
                      </div>
                      <span className="px-2 py-0.5 rounded font-mono text-[10px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {log.action}
                      </span>
                    </div>

                    <div className="text-sm text-slate-800 dark:text-slate-200">{log.summary}</div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-mono">
                      {log.repo_name && <span>儲存庫: {log.repo_name}</span>}
                      {log.target && <span>目標: {log.target}</span>}
                      {log.commit_sha && (
                        <span className="text-blue-600 dark:text-blue-400">
                          Commit: {log.commit_sha.slice(0, 7)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {activityLogs.length === 0 && (
                <div className="text-center py-12 text-slate-400 dark:text-slate-500 text-xs">
                  {activityLoading ? "載入中..." : "尚無符合條件的活動紀錄"}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
