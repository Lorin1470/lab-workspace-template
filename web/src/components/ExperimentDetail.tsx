import React, { useState, useEffect, useCallback } from "react";
import {
  Experiment,
  Course,
  ExperimentMembership,
  ActivityLogItem,
  AuthUser,
  ExperimentStatus,
  CourseRole,
} from "../types/index.ts";
import { api, ApiError } from "../api/client.ts";
import {
  ArrowLeft,
  FolderGit2,
  ExternalLink,
  Users,
  Activity,
  FileText,
  FolderTree,
  Download,
  RefreshCw,
  AlertCircle,
  Printer,
  ChevronDown,
  CheckCircle2,
  Bot,
} from "lucide-react";
import JSZip from "jszip";
import { WorkspaceManager, SimpleMarkdownViewer } from "./WorkspaceManager.tsx";
import { getReportRelativePath } from "../utils/workspace-ui.ts";

interface ExperimentDetailProps {
  experiment: Experiment;
  course: Course | null;
  userRole?: CourseRole;
  user: AuthUser | null;
  initialTab?: TabType;
  onBack: () => void;
  onSelectExperiment?: (exp: Experiment, initialTab?: TabType) => void;
  onExperimentUpdated: (updated: Experiment) => void;
  onNavigateSkillDownload?: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

type TabType = "files" | "report" | "activity" | "download" | "members" | "repository";

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

export const ExperimentDetail: React.FC<ExperimentDetailProps> = ({
  experiment,
  course,
  userRole,
  user,
  initialTab = "files",
  onBack,
  onSelectExperiment,
  onNavigateSkillDownload,
  onError,
  onSuccess,
}) => {
  const isCourseMode = course?.mode === "course";
  const resolvedRepo = isCourseMode ? (course?.github_repository || "") : (experiment.repository || "");
  const [activeTab, setActiveTab] = useState<TabType>(
    (initialTab as any) === "upload" ? "files" : (initialTab || "files")
  );
  const [members, setMembers] = useState<ExperimentMembership[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);

  // 活動紀錄過濾狀態
  const [activityActionFilter, setActivityActionFilter] = useState("");
  const [activitySearchKeyword, setActivitySearchKeyword] = useState("");

  // 同步外部傳入的 initialTab 或當切換至其他實驗時更新
  useEffect(() => {
    if (initialTab) {
      setActiveTab((initialTab as any) === "upload" ? "files" : initialTab);
    }
  }, [experiment.id, initialTab]);

  // Lab Switcher: 讀取同課程所有實驗
  const [courseExperiments, setCourseExperiments] = useState<Experiment[]>([]);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);

  useEffect(() => {
    if (course?.id) {
      api.experiments.listByCourse(course.id)
        .then((list) => setCourseExperiments(list))
        .catch(() => setCourseExperiments([]));
    }
  }, [course?.id]);

  // 實驗報告讀取狀態 (依據 shared/separate 模式動態解析檔案路徑)
  const [reportContent, setReportContent] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportNotFound, setReportNotFound] = useState(false);
  const [reportSha, setReportSha] = useState<string | null>(null);

  const currentReportPath = getReportRelativePath(experiment.report_mode, user?.github_id);

  const loadReport = useCallback(async () => {
    if (!currentReportPath) {
      setReportLoading(false);
      setReportError(
        experiment.report_mode === "separate"
          ? "此實驗為個別報告模式，需登入具有有效 GitHub ID 之帳號以讀取個人報告"
          : "無法解析實驗報告路徑"
      );
      setReportContent(null);
      return;
    }
    setReportLoading(true);
    setReportError(null);
    setReportNotFound(false);
    try {
      const file = await api.workspace.readFile(experiment.id, currentReportPath);
      setReportContent(file.content);
      setReportSha(file.sha);
    } catch (err: any) {
      const status = err?.status || (err instanceof ApiError ? err.status : 0);
      if (status === 404) {
        setReportNotFound(true);
        setReportContent(null);
      } else {
        setReportError(err?.message || "讀取實驗報告失敗");
      }
    } finally {
      setReportLoading(false);
    }
  }, [experiment.id, experiment.report_mode, currentReportPath]);

  useEffect(() => {
    if (activeTab === "report") {
      loadReport();
    }
  }, [activeTab, loadReport]);

  const isCollaborator = Boolean(
    userRole ||
    course?.role ||
    (user && members.some((m) => String(m.github_id) === String(user.github_id) && m.status === "active"))
  );

  // 載入成員
  const loadMembers = async () => {
    setMembersLoading(true);
    try {
      const list = await api.experimentMembers.list(experiment.id);
      setMembers(list);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  };

  // 載入活動紀錄
  const loadActivityLogs = async () => {
    setLogsLoading(true);
    try {
      const repoTarget = resolvedRepo || undefined;
      const res = await api.activity.list(
        repoTarget,
        experiment.experiment_code,
        50,
        {
          action: activityActionFilter || undefined,
          search: activitySearchKeyword.trim() || undefined,
        }
      );
      setActivityLogs(res.logs || []);
    } catch {
      setActivityLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
    loadActivityLogs();
  }, [experiment.id, experiment.repository, course?.github_repository, activeTab]);

  useEffect(() => {
    if (activeTab === "activity") {
      loadActivityLogs();
    }
  }, [activityActionFilter, activitySearchKeyword]);

  // 從真實 Workspace 讀取檔案後打包，禁止以示範內容冒充下載結果。
  const handleDownloadZip = async (type: "all" | "photos" | "raw") => {
    const zip = new JSZip();
    const prefix = `${experiment.experiment_code}-${experiment.name}`;
    try {
      const collectFiles = async (path = ""): Promise<string[]> => {
        const items = await api.workspace.listFiles(experiment.id, path || undefined);
        const files: string[] = [];
        for (const item of items) {
          if (item.type === "directory" || item.type === "dir") {
            files.push(...(await collectFiles(item.path)));
          } else if (type === "all" || item.path.startsWith(`${type}/`)) {
            files.push(item.path);
          }
        }
        return files;
      };

      const paths = await collectFiles();
      if (paths.length === 0) {
        onError(`Workspace 目前沒有可下載的${type === "all" ? "檔案" : `${type}/ 檔案`}。`);
        return;
      }

      for (const path of paths) {
        const file = await api.workspace.readFile(experiment.id, path);
        if (file.content_base64) {
          const bytes = Uint8Array.from(atob(file.content_base64), (char) => char.charCodeAt(0));
          zip.file(path, bytes);
        } else {
          zip.file(path, file.content);
        }
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${prefix}-${type}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      onError(err instanceof ApiError ? err.message : "無法從真實 Workspace 建立下載檔案。");
    }
  };

  const parseFilesChanged = (raw?: string): string[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
      return [String(parsed)];
    } catch {
      if (raw.includes(",")) {
        return raw.split(",").map((s) => s.trim()).filter(Boolean);
      }
      return [raw.trim()];
    }
  };

  const statusInfo = expStatusMap[experiment.status] || expStatusMap.not_started;

  return (
    <div className="space-y-6">
      {/* 頂部資訊列 */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm transition-colors">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer mt-1"
              title="返回課程"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {courseExperiments.length > 1 ? (
                  <div className="relative inline-block">
                    <button
                      type="button"
                      onClick={() => setIsSwitcherOpen(!isSwitcherOpen)}
                      className="inline-flex items-center space-x-1 text-xs font-mono font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 px-2.5 py-0.5 rounded hover:bg-blue-200 dark:hover:bg-blue-800/80 transition-colors cursor-pointer"
                      title="切換同課程實驗"
                    >
                      <span>{experiment.experiment_code.toUpperCase()}</span>
                      <ChevronDown className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                    </button>

                    {isSwitcherOpen && (
                      <div className="absolute left-0 mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-30 py-1 max-h-60 overflow-y-auto">
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-700">
                          切換同課程實驗
                        </div>
                        {courseExperiments.map((exp) => (
                          <button
                            key={exp.id}
                            type="button"
                            onClick={() => {
                              setIsSwitcherOpen(false);
                              if (exp.id !== experiment.id) {
                                onSelectExperiment?.(exp, activeTab);
                              }
                            }}
                            className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer ${
                              exp.id === experiment.id
                                ? "bg-blue-50/50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold"
                                : "text-slate-700 dark:text-slate-200"
                            }`}
                          >
                            <div className="truncate mr-2">
                              <span className="font-mono font-bold">{exp.experiment_code}</span>
                              <span className="ml-1.5 text-slate-500 dark:text-slate-400 truncate">{exp.name}</span>
                            </div>
                            {exp.id === experiment.id && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-xs font-mono font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 px-2.5 py-0.5 rounded">
                    {experiment.experiment_code.toUpperCase()}
                  </span>
                )}
                {course && (
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    {course.name} ({course.course_code})
                  </span>
                )}
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusInfo.badgeClass}`}>
                  {statusInfo.icon} {statusInfo.label}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                  {experiment.report_mode === "shared" ? "共同報告模式" : "個別報告模式"}
                </span>
              </div>

              <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-1.5">{experiment.name}</h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                {resolvedRepo && (
                  <a
                    href={`https://github.com/${resolvedRepo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-semibold"
                  >
                    <FolderGit2 className="w-3.5 h-3.5" />
                    <span>{resolvedRepo}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {isCourseMode && (
                  <span className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600">
                    工作區目錄：{experiment.experiment_code.toUpperCase()}
                  </span>
                )}
                <span>•</span>
                <span>Template v{experiment.config_version}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2 self-end md:self-auto flex-wrap">
            {resolvedRepo && (
              <a
                href={`https://github.com/${resolvedRepo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-colors bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white border dark:border-slate-600"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>開啟 GitHub Repo</span>
              </a>
            )}
          </div>
        </div>

        {/* 分頁導覽列 */}
        <div className="flex border-b border-slate-200 dark:border-slate-700 mt-6 -mb-6 space-x-1 overflow-x-auto">
          {[
            { id: "files", label: "📁 工作區 (Workspace)", icon: FolderTree },
            { id: "report", label: "📄 實驗報告", icon: FileText },
            { id: "activity", label: "📋 活動紀錄 (Activity Log)", icon: Activity },
            { id: "download", label: "📥 打包下載", icon: Download },
            { id: "members", label: `👥 實驗組員 (${members.length})`, icon: Users },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center space-x-2 py-3 px-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? "border-blue-600 dark:border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 分頁內容 */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm min-h-[420px] transition-colors">
        {/* 1. 工作區 (Workspace) */}
        {activeTab === "files" && (
          <WorkspaceManager
            experiment={experiment}
            course={course}
            user={user}
            isCollaborator={isCollaborator}
            onActivityRefresh={loadActivityLogs}
            onError={onError}
            onSuccess={onSuccess}
          />
        )}

        {/* 2. 實驗報告 */}
        {activeTab === "report" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-700 gap-2">
              <div className="flex items-center space-x-2 text-sm text-slate-600 dark:text-slate-300">
                <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>
                  報告檔案：
                  <code className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-xs font-mono ml-1 text-slate-800 dark:text-slate-200">
                    {currentReportPath}
                  </code>
                </span>
                {reportSha && (
                  <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                    SHA: {reportSha.slice(0, 7)}
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={loadReport}
                  disabled={reportLoading}
                  className="inline-flex items-center space-x-1.5 text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  title="重新讀取實驗報告"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${reportLoading ? "animate-spin" : ""}`} />
                  <span>重新整理</span>
                </button>

                <button
                  onClick={() => setActiveTab("files")}
                  className="inline-flex items-center space-x-1.5 text-xs bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-700 dark:text-blue-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer font-medium border border-blue-200 dark:border-blue-800"
                  title="前往工作區編輯報告"
                >
                  <FolderTree className="w-3.5 h-3.5" />
                  <span>前往工作區編輯</span>
                </button>

                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center space-x-1.5 text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>列印 / 匯出 PDF</span>
                </button>
              </div>
            </div>

            {reportLoading && (
              <div className="flex flex-col items-center justify-center py-16 space-y-3 text-slate-400 dark:text-slate-500">
                <RefreshCw className="w-7 h-7 animate-spin text-blue-500" />
                <span className="text-sm">正在載入實驗報告 ({currentReportPath})...</span>
              </div>
            )}

            {!reportLoading && reportError && (
              <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{reportError}</span>
                </div>
                <button
                  onClick={loadReport}
                  className="px-3 py-1 bg-red-100 dark:bg-red-900/60 hover:bg-red-200 dark:hover:bg-red-800 text-red-800 dark:text-red-200 rounded font-semibold transition-colors cursor-pointer"
                >
                  重試
                </button>
              </div>
            )}

            {!reportLoading && reportNotFound && (
              <div className="border border-dashed border-slate-200 dark:border-slate-700 rounded-xl py-16 text-center space-y-3">
                <FileText className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600" />
                <p className="text-base font-bold text-slate-700 dark:text-slate-200">尚未建立實驗報告</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                  此實驗工作區尚未建立報告檔案（<code className="font-mono text-slate-700 dark:text-slate-300">{currentReportPath}</code>）。
                  您可以直接在瀏覽器工作區中建立並編輯報告，存檔後系統會自動同步至雲端。
                </p>
                <div className="pt-2">
                  <button
                    onClick={() => setActiveTab("files")}
                    className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-xs"
                  >
                    <FolderTree className="w-3.5 h-3.5" />
                    <span>前往「📁 工作區」建立報告</span>
                  </button>
                </div>
              </div>
            )}

            {!reportLoading && !reportNotFound && !reportError && reportContent !== null && (
              <article className="prose max-w-none text-slate-800 dark:text-slate-100 space-y-4">
                <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm space-y-1">
                  <div><strong>實驗名稱</strong>：{experiment.name} ({experiment.experiment_code})</div>
                  <div><strong>報告模式</strong>：{experiment.report_mode === "shared" ? "全組共同撰寫 (shared)" : "個別報告模式 (separate)"}</div>
                  <div><strong>報告檔案</strong>：<code className="font-mono text-xs bg-slate-100 dark:bg-slate-700 px-1 py-0.5 rounded">{currentReportPath}</code></div>
                  <div><strong>所屬 Repository</strong>：{resolvedRepo}</div>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-700/60 pt-4">
                  <SimpleMarkdownViewer content={reportContent} />
                </div>
              </article>
            )}
          </div>
        )}

        {/* 3. 活動紀錄 */}
        {activeTab === "activity" && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700/60 gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    工作區操作稽核日誌（Append-Only 唯讀紀錄）
                  </span>
                  <span className="text-[10px] font-mono bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded font-semibold border border-blue-100 dark:border-blue-900">
                    Cloudflare D1 持久化
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  所有寫入操作均已通過伺服器端 Session 防偽校驗與 Commit SHA 綁定保護。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="搜尋摘要、發起人或目標..."
                  value={activitySearchKeyword}
                  onChange={(e) => setActivitySearchKeyword(e.target.value)}
                  className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 w-44 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:border-blue-500"
                />

                <select
                  value={activityActionFilter}
                  onChange={(e) => setActivityActionFilter(e.target.value)}
                  className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                >
                  <option value="">全部動作類型</option>
                  <option value="file_created">建立檔案 (file_created)</option>
                  <option value="file_modified">更新檔案 (file_modified)</option>
                  <option value="file_deleted">刪除檔案 (file_deleted)</option>
                  <option value="raw_uploaded">原始數據上傳 (raw_uploaded)</option>
                  <option value="photo_uploaded">照片上傳 (photo_uploaded)</option>
                </select>

                <button
                  onClick={loadActivityLogs}
                  disabled={logsLoading}
                  className="inline-flex items-center space-x-1 text-xs border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  title="重新整理活動日誌"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {logsLoading ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-3 text-slate-400 dark:text-slate-500">
                <RefreshCw className="w-7 h-7 animate-spin text-blue-500" />
                <span className="text-sm">正在載入活動日誌...</span>
              </div>
            ) : activityLogs.length === 0 ? (
              <div className="text-center py-12 text-slate-400 dark:text-slate-500 text-xs">
                {activityActionFilter || activitySearchKeyword ? "找不到符合過濾條件的紀錄" : "此實驗專案目前尚無任何活動日誌。"}
              </div>
            ) : (
              <div className="space-y-2">
                {activityLogs.map((log) => {
                  let detailsObj: any = null;
                  try {
                    if (log.details_json) detailsObj = JSON.parse(log.details_json);
                  } catch {}

                  const filesChanged = parseFilesChanged(log.files_changed);
                  const isRejected = log.approval_status === "rejected";

                  return (
                    <div
                      key={log.id}
                      className={`p-3.5 rounded-xl border transition-colors flex items-start space-x-3 ${
                        isRejected
                          ? "border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-950/30"
                          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50/60 dark:hover:bg-slate-700/40"
                      }`}
                    >
                      <div className="flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100 font-mono">
                            @{log.actor_name || log.actor_id}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded font-mono font-semibold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                            {log.action}
                          </span>

                          <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">{log.timestamp}</span>
                        </div>

                        <p className="text-sm text-slate-700 dark:text-slate-200">{log.summary}</p>

                        {isRejected && detailsObj?.rejection_reason && (
                          <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-2.5 py-1 rounded border border-red-200 dark:border-red-800 font-mono">
                            攔截原因：{detailsObj.rejection_reason}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400 font-mono pt-0.5">
                          {log.target && (
                            <span className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-1.5 py-0.5 rounded text-[11px]">
                              🎯 目標: {log.target}
                            </span>
                          )}
                          {log.requested_by && <span>發起人: @{log.requested_by}</span>}
                          {log.approved_by && <span>核准人: @{log.approved_by}</span>}
                          {log.commit_sha && (
                            <a
                              href={`https://github.com/${log.repo_name || resolvedRepo}/commit/${log.commit_sha}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-semibold"
                            >
                              <span>Commit: {log.commit_sha.slice(0, 7)}</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>

                        {filesChanged.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 font-mono">
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">異動檔案:</span>
                            {filesChanged.map((file, idx) => (
                              <span
                                key={idx}
                                className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-1.5 py-0.2 rounded text-[11px] text-slate-600 dark:text-slate-400"
                              >
                                {file}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 4. 打包下載 */}
        {activeTab === "download" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              免經 R2 中轉的一鍵打包串流下載：
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-blue-400 dark:hover:border-blue-500 transition-colors">
                <div>
                  <h4 className="font-semibold text-sm text-slate-800 dark:text-slate-100">📸 打包下載全部照片</h4>
                  <p className="text-xs text-slate-400 dark:text-slate-400 mt-1">打包 photos/ 目錄中的所有量測照片</p>
                </div>
                <button
                  onClick={() => handleDownloadZip("photos")}
                  className="mt-4 w-full bg-slate-100 dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-blue-900/50 hover:text-blue-600 dark:hover:text-blue-300 text-slate-700 dark:text-slate-200 text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下載 photos.zip</span>
                </button>
              </div>

              <div className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-blue-400 dark:hover:border-blue-500 transition-colors">
                <div>
                  <h4 className="font-semibold text-sm text-slate-800 dark:text-slate-100">📁 下載量測原始數據</h4>
                  <p className="text-xs text-slate-400 dark:text-slate-400 mt-1">打包 raw/ 目錄中的所有原始 CSV/數據</p>
                </div>
                <button
                  onClick={() => handleDownloadZip("raw")}
                  className="mt-4 w-full bg-slate-100 dark:bg-slate-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/50 hover:text-emerald-600 dark:hover:text-emerald-300 text-slate-700 dark:text-slate-200 text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下載 raw.zip</span>
                </button>
              </div>

              <div className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-blue-400 dark:hover:border-blue-500 transition-colors">
                <div>
                  <h4 className="font-semibold text-sm text-slate-800 dark:text-slate-100">📦 下載完整實驗專案包</h4>
                  <p className="text-xs text-slate-400 dark:text-slate-400 mt-1">包含所有數據、圖表、報告與工作區檔案</p>
                </div>
                <button
                  onClick={() => handleDownloadZip("all")}
                  className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下載完整 ZIP</span>
                </button>
              </div>

              <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
                <div>
                  <div className="flex items-center space-x-1.5 text-purple-600 dark:text-purple-400 mb-1">
                    <Bot className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">AI Agent Skill</span>
                  </div>
                  <h4 className="font-semibold text-slate-800 dark:text-slate-100 text-sm">github-workspace Skill</h4>
                  <p className="text-xs text-slate-400 dark:text-slate-400 mt-1">取得標準 Agent Skill 檔案、ZIP 壓縮包與精簡安裝提示詞</p>
                </div>
                <button
                  type="button"
                  onClick={onNavigateSkillDownload}
                  className="mt-4 w-full bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 dark:hover:bg-purple-900 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                >
                  <Bot className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  <span>前往 Skill 下載頁</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 5. 實驗成員 (唯讀名單) */}
        {activeTab === "members" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              指派至本實驗的組員清單。
            </p>

            {membersLoading ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-3 text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <RefreshCw className="w-7 h-7 animate-spin text-blue-500" />
                <span className="text-sm">正在載入成員名單...</span>
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                      <tr>
                        <th className="px-5 py-3">GitHub 使用者</th>
                        <th className="px-5 py-3">GitHub ID</th>
                        <th className="px-5 py-3">角色</th>
                        <th className="px-5 py-3">組別 (Group)</th>
                        <th className="px-5 py-3">狀態</th>
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
                                {m.role === "assistant" ? "助教" : "學生"}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 font-medium text-slate-700 dark:text-slate-300">
                              {m.group_name || <span className="text-slate-400 dark:text-slate-500 text-xs">未分組</span>}
                            </td>
                            <td className="px-5 py-3.5">
                              {m.status === "active" ? (
                                <span className="inline-flex items-center space-x-1 text-xs text-emerald-700 dark:text-emerald-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                  <span>正常</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center space-x-1 text-xs text-slate-500 dark:text-slate-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500"></span>
                                  <span>已停用</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {members.length === 0 && (
                        <tr>
                          <td colSpan={5} className="text-center py-8 text-slate-400 dark:text-slate-500 text-xs">
                            目前尚無任何實驗組員
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
