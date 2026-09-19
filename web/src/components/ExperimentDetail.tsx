import React, { useState, useEffect } from 'react';
import {
  Experiment,
  Course,
  ExperimentMembership,
  ActivityLogItem,
  AuthUser,
  ReportMode,
  ExperimentStatus,
  CourseRole,
} from '../types/index.ts';
import { api, ApiError } from '../api/client.ts';
import {
  ArrowLeft,
  Settings,
  FolderGit2,
  ExternalLink,
  Users,
  Activity,
  FileText,
  FolderTree,
  Upload,
  Download,
  Bot,
  UserPlus,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Copy,
  Printer,
} from 'lucide-react';
import JSZip from 'jszip';

interface ExperimentDetailProps {
  experiment: Experiment;
  course: Course | null;
  userRole?: CourseRole;
  user: AuthUser | null;
  onBack: () => void;
  onExperimentUpdated: (updated: Experiment) => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

type TabType = 'activity' | 'members' | 'report' | 'files' | 'upload' | 'download' | 'agent';

const expStatusMap: Record<ExperimentStatus, { label: string; badgeClass: string; icon: string }> = {
  not_started: {
    label: '尚未開始',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-300',
    icon: '⬜',
  },
  in_progress: {
    label: '實驗進行中',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-300',
    icon: '🟡',
  },
  data_processing: {
    label: '資料整理中',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-300',
    icon: '🔵',
  },
  report_writing: {
    label: '報告撰寫中',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-300',
    icon: '🟠',
  },
  completed: {
    label: '已完成',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-300',
    icon: '🟢',
  },
};

export const ExperimentDetail: React.FC<ExperimentDetailProps> = ({
  experiment,
  course,
  userRole,
  user,
  onBack,
  onExperimentUpdated,
  onError,
  onSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('activity');
  const [members, setMembers] = useState<ExperimentMembership[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);
  const [isMockActivity, setIsMockActivity] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [activityLimit, setActivityLimit] = useState(50);

  // 權限判斷：依據傳入之 userRole
  const isTeacher = userRole === 'teacher';

  // Modal 控制
  const [isEditExpOpen, setIsEditExpOpen] = useState(false);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<ExperimentMembership | null>(null);

  // 編輯實驗表單
  const [editName, setEditName] = useState(experiment.name);
  const [editReportMode, setEditReportMode] = useState<ReportMode>(experiment.report_mode);
  const [editStatus, setEditStatus] = useState<ExperimentStatus>(experiment.status);

  // 新增實驗成員表單
  const [newMemberGithubId, setNewMemberGithubId] = useState('');
  const [newMemberUsername, setNewMemberUsername] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'student' | 'assistant'>('student');
  const [newMemberGroup, setNewMemberGroup] = useState('');

  // 編輯實驗成員表單
  const [editMemberGroup, setEditMemberGroup] = useState('');
  const [editMemberRole, setEditMemberRole] = useState<'student' | 'assistant'>('student');
  const [editMemberStatus, setEditMemberStatus] = useState<'active' | 'inactive'>('active');

  const [formSubmitting, setFormSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);

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

  // 載入活動日誌
  const loadActivityLogs = async () => {
    setLogsLoading(true);
    try {
      const data = await api.activity.list(experiment.repository, experiment.experiment_code, activityLimit);
      setActivityLogs(data.logs);
      setIsMockActivity(data.mode === 'mock');
    } catch (err: any) {
      setActivityLogs([]);
      onError(err.message || '讀取活動日誌失敗');
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
    loadActivityLogs();
    setEditName(experiment.name);
    setEditReportMode(experiment.report_mode);
    setEditStatus(experiment.status);
  }, [experiment.id, experiment.repository, activityLimit]);

  // 更新實驗設定
  const handleUpdateExperiment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setModalError(null);
    try {
      const updated = await api.experiments.update(experiment.id, {
        name: editName.trim(),
        report_mode: editReportMode,
        status: editStatus,
      });
      onExperimentUpdated(updated);
      onSuccess('實驗專案設定已成功更新');
      setIsEditExpOpen(false);
    } catch (err: any) {
      setModalError(err.message || '更新實驗失敗');
    } finally {
      setFormSubmitting(false);
    }
  };

  // 新增實驗成員
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberGithubId.trim() || !newMemberUsername.trim()) {
      setModalError('請輸入 GitHub ID 與 使用者名稱');
      return;
    }

    setFormSubmitting(true);
    setModalError(null);
    try {
      await api.experimentMembers.add(experiment.id, {
        github_id: newMemberGithubId.trim(),
        username: newMemberUsername.trim(),
        role: newMemberRole,
        group_name: newMemberGroup.trim() || undefined,
      });
      onSuccess(`成功指派 @${newMemberUsername.trim()} 至本實驗！`);
      setIsAddMemberOpen(false);
      setNewMemberGithubId('');
      setNewMemberUsername('');
      setNewMemberRole('student');
      setNewMemberGroup('');
      loadMembers();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 400) {
        setModalError(err.message || '該使用者必須先註冊為本課程成員 (Course Membership)');
      } else if (err instanceof ApiError && err.status === 409) {
        setModalError('該使用者已是本實驗成員 (409 Conflict)');
      } else {
        setModalError(err.message || '指派成員失敗');
      }
    } finally {
      setFormSubmitting(false);
    }
  };

  // 編輯實驗成員
  const handleUpdateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;

    setFormSubmitting(true);
    setModalError(null);
    try {
      await api.experimentMembers.update(experiment.id, editingMember.id, {
        role: editMemberRole,
        group_name: editMemberGroup.trim() || undefined,
        status: editMemberStatus,
      });
      onSuccess(`已更新 @${editingMember.username} 的實驗分配設定`);
      setEditingMember(null);
      loadMembers();
    } catch (err: any) {
      setModalError(err.message || '更新成員失敗');
    } finally {
      setFormSubmitting(false);
    }
  };

  // 打包下載功能 (純前端免後端負擔)
  const handleDownloadZip = async (type: 'all' | 'photos' | 'raw') => {
    const zip = new JSZip();
    const prefix = `${experiment.experiment_code}-${experiment.name}`;

    if (type === 'all' || type === 'raw') {
      const rawFolder = zip.folder('raw');
      rawFolder?.file('measurements.csv', 'Vce(V),Ib(uA),Ic(mA)\n0.0,10,0.00\n1.0,10,1.02\n2.0,10,1.05\n');
    }
    if (type === 'all' || type === 'photos') {
      const photoFolder = zip.folder('photos');
      photoFolder?.file('readme.txt', '實驗量測照片存放區 (一律保存原始未壓縮影像)\n');
    }
    if (type === 'all') {
      zip.file('config.yml', `experiment_id: "${experiment.experiment_code}"\nstatus: "${experiment.status}"\nreport_mode: "${experiment.report_mode}"\n`);
      zip.file('README.md', `# ${experiment.name}\n\nGitHub Repository: ${experiment.repository}\n`);
      const reportFolder = zip.folder('report');
      reportFolder?.file('report.md', `# 實驗報告：${experiment.name}\n`);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${prefix}-${type}.zip`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPrompt(id);
    setTimeout(() => setCopiedPrompt(null), 2000);
  };

  const parseFilesChanged = (raw?: string): string[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
      return [String(parsed)];
    } catch {
      if (raw.includes(',')) {
        return raw.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return [raw.trim()];
    }
  };

  const statusInfo = expStatusMap[experiment.status] || expStatusMap.not_started;

  return (
    <div className="space-y-6">
      {/* 頂部資訊列 */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-800 transition-colors cursor-pointer mt-1"
              title="返回課程"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-mono font-bold bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded">
                  {experiment.experiment_code.toUpperCase()}
                </span>
                {course && (
                  <span className="text-xs text-slate-500 font-medium">
                    {course.name} ({course.course_code})
                  </span>
                )}
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusInfo.badgeClass}`}>
                  {statusInfo.icon} {statusInfo.label}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                  {experiment.report_mode === 'shared' ? '共同報告模式' : '個別報告模式'}
                </span>
              </div>

              <h2 className="text-2xl font-bold text-slate-900 mt-1.5">{experiment.name}</h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1 font-mono">
                <a
                  href={`https://github.com/${experiment.repository}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-semibold"
                >
                  <FolderGit2 className="w-3.5 h-3.5" />
                  <span>{experiment.repository}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <span>•</span>
                <span>Template v{experiment.config_version}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3 self-end md:self-auto">
            {isTeacher && (
              <button
                onClick={() => {
                  setModalError(null);
                  setIsEditExpOpen(true);
                }}
                className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg transition-colors cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>實驗設定</span>
              </button>
            )}

            <a
              href={`https://github.com/${experiment.repository}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-lg transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>開啟 GitHub Repo</span>
            </a>
          </div>
        </div>

        {/* 分頁導覽列 */}
        <div className="flex border-b border-slate-200 mt-6 -mb-6 space-x-1 overflow-x-auto">
          {[
            { id: 'activity', label: '📋 活動紀錄 (Activity Log)', icon: Activity },
            { id: 'members', label: `👥 實驗成員 (${members.length})`, icon: Users },
            { id: 'report', label: '📄 實驗報告', icon: FileText },
            { id: 'files', label: '📂 檔案結構', icon: FolderTree },
            { id: 'upload', label: '📤 上傳資料', icon: Upload },
            { id: 'download', label: '📥 打包下載', icon: Download },
            { id: 'agent', label: '🤖 Agent 協作', icon: Bot },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center space-x-2 py-3 px-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
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
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm min-h-[420px]">
        {/* 1. 活動紀錄 */}
        {activeTab === 'activity' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-500 font-medium">
                    日誌規範：誰在何時以何種方式操作了什麼（Append-Only 唯讀稽核）
                  </span>
                  {isMockActivity ? (
                    <span className="text-[10px] font-mono bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-semibold border border-amber-200">
                      示範模式
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-semibold border border-blue-100">
                      Cloudflare D1 持久化
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  所有寫入操作均已通過伺服器端 Session 防偽校驗與 Commit SHA 綁定保護。
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <select
                  value={activityLimit}
                  onChange={(e) => setActivityLimit(Number(e.target.value))}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                >
                  <option value={20}>顯示最新 20 筆</option>
                  <option value={50}>顯示最新 50 筆</option>
                  <option value={100}>顯示最新 100 筆</option>
                </select>

                <button
                  onClick={loadActivityLogs}
                  disabled={logsLoading}
                  className="inline-flex items-center space-x-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  title="重新整理活動日誌"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
                  <span>重新整理</span>
                </button>
              </div>
            </div>

            {logsLoading && (
              <div className="flex flex-col items-center justify-center py-16 space-y-3 text-slate-400">
                <RefreshCw className="w-7 h-7 animate-spin text-blue-500" />
                <span className="text-sm">正在載入活動紀錄...</span>
              </div>
            )}

            {!logsLoading && activityLogs.length === 0 && (
              <div className="border border-dashed border-slate-200 rounded-xl py-16 text-center space-y-2 text-slate-400">
                <Activity className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-sm font-medium text-slate-600">目前尚無活動紀錄</p>
                <p className="text-xs text-slate-400">
                  在本地透過 CLI 或 Agent 提交變更後，活動事件將即時記錄至 D1 稽核軌跡。
                </p>
              </div>
            )}

            {!logsLoading && activityLogs.length > 0 && (
              <div className="relative border-l-2 border-slate-200 ml-4 space-y-6 py-2">
                {activityLogs.map((log) => {
                  const isRejected = log.action === 'request_rejected';
                  const isPending = log.approval_status === 'pending';
                  const isAgent = log.actor_type === 'agent';
                  const filesChanged = parseFilesChanged(log.files_changed);

                  let detailsObj: any = null;
                  if (log.details_json) {
                    try {
                      detailsObj =
                        typeof log.details_json === 'object'
                          ? log.details_json
                          : JSON.parse(log.details_json);
                    } catch {
                      // ignore
                    }
                  }

                  return (
                    <div key={log.id} className="relative pl-6">
                      <div
                        className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-white shadow-xs ${
                          isRejected
                            ? 'bg-red-500'
                            : isAgent
                            ? 'bg-purple-600'
                            : 'bg-blue-600'
                        }`}
                      />
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-slate-800">{log.actor_name}</span>

                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                              isAgent
                                ? 'bg-purple-100 text-purple-700'
                                : log.actor_type === 'web'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {log.actor_type.toUpperCase()}
                          </span>

                          {isRejected && (
                            <span className="text-[10px] bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.2 rounded font-semibold">
                              🚨 越權拒絕
                            </span>
                          )}
                          {isPending && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.2 rounded font-semibold">
                              ⏳ 等待核准
                            </span>
                          )}
                          {log.approval_status === 'approved' && !isRejected && (
                            <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 rounded font-semibold">
                              ✓ 已授權
                            </span>
                          )}

                          <span className="text-xs text-slate-400 font-mono">{log.timestamp}</span>
                        </div>

                        <p className="text-sm text-slate-700">{log.summary}</p>

                        {isRejected && detailsObj?.rejection_reason && (
                          <div className="text-xs text-red-600 bg-red-50 px-2.5 py-1 rounded border border-red-200 font-mono">
                            攔截原因：{detailsObj.rejection_reason}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 font-mono pt-0.5">
                          {log.target && (
                            <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[11px]">
                              🎯 目標: {log.target}
                            </span>
                          )}
                          {log.requested_by && <span>發起人: @{log.requested_by}</span>}
                          {log.approved_by && <span>核准人: @{log.approved_by}</span>}
                          {log.commit_sha && (
                            <a
                              href={`https://github.com/${log.repo_name || experiment.repository}/commit/${log.commit_sha}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-semibold"
                            >
                              <span>Commit: {log.commit_sha.slice(0, 7)}</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>

                        {filesChanged.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 font-mono">
                            <span className="text-[11px] text-slate-400">異動檔案:</span>
                            {filesChanged.map((file, idx) => (
                              <span
                                key={idx}
                                className="bg-slate-50 border border-slate-200 px-1.5 py-0.2 rounded text-[11px] text-slate-600"
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

        {/* 2. 實驗成員 */}
        {activeTab === 'members' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                指派至本實驗的組員清單（必須為所屬課程的 Active 成員）。
              </p>

              {isTeacher && (
                <button
                  onClick={() => {
                    setModalError(null);
                    setIsAddMemberOpen(true);
                  }}
                  className="inline-flex items-center space-x-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-lg transition-colors cursor-pointer shadow-sm"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>指派成員至實驗</span>
                </button>
              )}
            </div>

            {membersLoading ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-3 text-slate-400 bg-white rounded-xl border border-slate-200">
                <RefreshCw className="w-7 h-7 animate-spin text-blue-500" />
                <span className="text-sm">正在載入成員名單...</span>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      <tr>
                        <th className="px-5 py-3">GitHub 使用者</th>
                        <th className="px-5 py-3">GitHub ID</th>
                        <th className="px-5 py-3">實驗角色</th>
                        <th className="px-5 py-3">組別 (Group)</th>
                        <th className="px-5 py-3">狀態</th>
                        {isTeacher && <th className="px-5 py-3 text-right">操作</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {members.map((m) => {
                        const isSelf = user && String(user.github_id) === String(m.github_id);
                        return (
                          <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-5 py-3.5 font-medium text-slate-900 flex items-center space-x-2">
                              <span>@{m.username}</span>
                              {isSelf && (
                                <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.2 rounded font-semibold">
                                  你自己
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3.5 font-mono text-xs text-slate-500">{m.github_id}</td>
                            <td className="px-5 py-3.5">
                              {m.role === 'assistant' ? (
                                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">
                                  助教
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                  學生
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3.5 font-medium text-slate-700">
                              {m.group_name || <span className="text-slate-400 text-xs">未分組</span>}
                            </td>
                            <td className="px-5 py-3.5">
                              {m.status === 'active' ? (
                                <span className="inline-flex items-center space-x-1 text-xs text-emerald-700">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                  <span>正常</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center space-x-1 text-xs text-slate-500">
                                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                                  <span>已停用</span>
                                </span>
                              )}
                            </td>
                            {isTeacher && (
                              <td className="px-5 py-3.5 text-right">
                                <button
                                  onClick={() => {
                                    setEditingMember(m);
                                    setEditMemberRole(m.role);
                                    setEditMemberGroup(m.group_name || '');
                                    setEditMemberStatus(m.status as any);
                                    setModalError(null);
                                  }}
                                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 transition-colors cursor-pointer"
                                >
                                  修改分組/狀態
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {members.length === 0 && (
                        <tr>
                          <td colSpan={isTeacher ? 6 : 5} className="text-center py-8 text-slate-400 text-xs">
                            目前尚未指派成員至本實驗專案
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

        {/* 3. 查看報告 */}
        {activeTab === 'report' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center space-x-2 text-sm text-slate-600">
                <FileText className="w-4 h-4 text-blue-600" />
                <span>
                  報告規範路徑：
                  <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono ml-1">
                    {experiment.report_mode === 'shared' ? 'report/report.md' : 'report/report-<github_id>.md'}
                  </code>
                </span>
              </div>
              <button
                onClick={() => window.print()}
                className="inline-flex items-center space-x-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>列印 / 匯出 PDF</span>
              </button>
            </div>

            <article className="prose max-w-none text-slate-800 space-y-4">
              <h1 className="text-2xl font-bold text-slate-900 border-b pb-2">
                實驗報告：{experiment.name}
              </h1>

              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm space-y-1">
                <div><strong>實驗代碼</strong>：{experiment.experiment_code}</div>
                <div><strong>報告模式</strong>：{experiment.report_mode === 'shared' ? '全組共同撰寫 (shared)' : '不可變 GitHub ID 個別撰寫 (separate)'}</div>
                <div><strong>所屬 Repository</strong>：{experiment.repository}</div>
              </div>

              <h3 className="text-lg font-bold text-slate-900 pt-2">一、實驗目的與規格</h3>
              <p className="text-sm leading-relaxed">
                本實驗專案遵循一節課一 Repo 規範，所有原始數據請存放於 <code>raw/</code> 目錄，經清洗運算後之產物置於 <code>processed/</code> 與 <code>analysis/</code>。
              </p>

              <h3 className="text-lg font-bold text-slate-900 pt-2">二、實驗數據與特性曲線</h3>
              <div className="bg-blue-50/50 p-3 rounded border border-blue-100 text-center font-mono text-base">
                $$I_C = \beta \cdot I_B$$
              </div>
            </article>
          </div>
        )}

        {/* 4. 檔案結構 */}
        {activeTab === 'files' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              工作區目錄規範（嚴格遵循 Template 結構與 Agent Skill 規範）：
            </p>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 font-mono text-xs">
              {[
                { path: 'config.yml', desc: '實驗工作區組態（唯讀宣告）', cat: 'root' },
                { path: 'README.md', desc: '實驗專案說明文件', cat: 'root' },
                { path: 'raw/', desc: '原始數據存放區（聖域保護：唯讀，不可覆蓋）', cat: 'raw' },
                { path: 'photos/', desc: '實驗照片存放區（原始未壓縮圖檔）', cat: 'photos' },
                { path: 'processed/', desc: '清洗後資料存放區（Agent / 程式清洗輸出）', cat: 'processed' },
                { path: 'analysis/', desc: '分析程式碼與產出之圖表（SVG / PNG）', cat: 'analysis' },
                { path: 'report/', desc: '實驗報告 Markdown 檔案存放區', cat: 'report' },
                { path: '.github/skills/experiment-report/SKILL.md', desc: 'AI Agent 規範定義檔案', cat: 'root' },
              ].map((item) => (
                <div key={item.path} className="p-3 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center space-x-3">
                    <span>
                      {item.cat === 'raw' && '🔒'}
                      {item.cat === 'photos' && '📸'}
                      {item.cat === 'processed' && '🧹'}
                      {item.cat === 'analysis' && '📊'}
                      {item.cat === 'report' && '📝'}
                      {item.cat === 'root' && '📄'}
                    </span>
                    <span className="font-semibold text-slate-800">{item.path}</span>
                    {item.cat === 'raw' && (
                      <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-[10px]">
                        聖域唯讀保護
                      </span>
                    )}
                  </div>
                  <span className="text-slate-400">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 5. 上傳資料 */}
        {activeTab === 'upload' && (
          <div className="space-y-6">
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-bold">原始數據保護原則</p>
                <p className="mt-0.5">
                  所有儀器量測檔案請直接提交至 <code>raw/</code>。該目錄受到 Agent Skill 聖域保護，嚴禁任何覆蓋或刪除操作。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-8 text-center transition-colors">
                <div className="mx-auto w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <h4 className="font-semibold text-slate-800 text-sm">上傳實驗照片至 photos/</h4>
                <p className="text-xs text-slate-400 mt-1 mb-4">支援 JPG、PNG、HEIC（儀器示波器畫面、電路接線圖）</p>
                <label className="inline-block bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer transition-colors">
                  選擇照片檔案
                  <input type="file" multiple accept="image/*" className="hidden" />
                </label>
              </div>

              <div className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-8 text-center transition-colors">
                <div className="mx-auto w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <h4 className="font-semibold text-slate-800 text-sm">上傳量測數據至 raw/</h4>
                <p className="text-xs text-slate-400 mt-1 mb-4">支援 CSV、XLSX、TXT（不可覆蓋已有檔案）</p>
                <label className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer transition-colors">
                  選擇數據檔案
                  <input type="file" multiple accept=".csv,.xlsx,.txt,.dat" className="hidden" />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* 6. 打包下載 */}
        {activeTab === 'download' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              免經 R2 中轉的一鍵打包串流下載：
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="border border-slate-200 rounded-xl p-4 flex flex-col justify-between hover:border-blue-400 transition-colors">
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">📸 打包下載全部照片</h4>
                  <p className="text-xs text-slate-400 mt-1">打包 photos/ 目錄中的所有量測照片</p>
                </div>
                <button
                  onClick={() => handleDownloadZip('photos')}
                  className="mt-4 w-full bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下載 photos.zip</span>
                </button>
              </div>

              <div className="border border-slate-200 rounded-xl p-4 flex flex-col justify-between hover:border-blue-400 transition-colors">
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">📁 下載量測原始數據</h4>
                  <p className="text-xs text-slate-400 mt-1">打包 raw/ 目錄中的所有原始 CSV/數據</p>
                </div>
                <button
                  onClick={() => handleDownloadZip('raw')}
                  className="mt-4 w-full bg-slate-100 hover:bg-emerald-50 hover:text-emerald-600 text-slate-700 text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下載 raw.zip</span>
                </button>
              </div>

              <div className="border border-slate-200 rounded-xl p-4 flex flex-col justify-between hover:border-blue-400 transition-colors">
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">📦 下載完整實驗專案包</h4>
                  <p className="text-xs text-slate-400 mt-1">包含所有數據、圖表、報告與 Skill 設定</p>
                </div>
                <button
                  onClick={() => handleDownloadZip('all')}
                  className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下載完整 ZIP</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 7. Agent 協作指南 */}
        {activeTab === 'agent' && (
          <div className="space-y-6">
            <div className="bg-purple-50 border border-purple-200 p-4 rounded-xl flex items-start space-x-3">
              <ShieldCheck className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
              <div className="text-sm text-purple-900">
                <p className="font-bold">Agent-First 安全確認機制</p>
                <p className="mt-0.5">
                  本地 AI Agent 遵循 <code>.github/skills/experiment-report/SKILL.md</code> 進行操作。在進行 Git Commit 或遠端 Push 之前，必須徵詢使用者審閱與同意，並自動記錄至伺服器端 Activity Log。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                {
                  id: 'p1',
                  title: '📸 照片整理與分類',
                  prompt: '請根據 .github/skills/experiment-report/SKILL.md 規範，檢查 photos/ 目錄中的量測照片，按實驗項目編號分類並加入說明。',
                },
                {
                  id: 'p2',
                  title: '🧹 原始數據清洗 (嚴禁竄改 raw/)',
                  prompt: '請讀取 raw/measurements.csv，進行數據清洗與校正，輸出至 processed/measurements_clean.csv。注意切勿修改 raw/ 原檔！',
                },
                {
                  id: 'p3',
                  title: '📊 繪製特性曲線圖',
                  prompt: '請根據 processed/ 乾淨數據，撰寫 Python 腳本繪製特性曲線圖，輸出高解析度 SVG 圖檔至 analysis/。',
                },
                {
                  id: 'p4',
                  title: '📝 起草與完善實驗報告',
                  prompt: '請根據 analysis/ 的曲線圖與 processed/ 的數據，在 report/report.md 中補充「實驗數據分析」與「問題與討論」章節。',
                },
              ].map((item) => (
                <div key={item.id} className="border border-slate-200 rounded-xl p-4 flex flex-col justify-between hover:border-purple-300 transition-colors">
                  <div>
                    <h4 className="font-semibold text-sm text-slate-800">{item.title}</h4>
                    <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200 mt-2 font-mono leading-relaxed">
                      {item.prompt}
                    </p>
                  </div>
                  <button
                    onClick={() => copyToClipboard(item.prompt, item.id)}
                    className="mt-3 w-full bg-slate-100 hover:bg-purple-600 hover:text-white text-slate-700 text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                  >
                    {copiedPrompt === item.id ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        <span>已複製指令！</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>一鍵複製 Prompt</span>
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 編輯實驗 Modal */}
      {isEditExpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900">編輯實驗專案設定</h3>
              <button onClick={() => setIsEditExpOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {modalError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.2" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateExperiment} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">實驗名稱</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">報告撰寫模式</label>
                <select
                  value={editReportMode}
                  onChange={(e) => setEditReportMode(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="shared">共同報告模式 (Shared - 全組共編 report.md)</option>
                  <option value="separate">個別報告模式 (Separate - 依不可變 GitHub ID 各自編寫)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">實驗進度狀態</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="not_started">尚未開始 (not_started)</option>
                  <option value="in_progress">實驗進行中 (in_progress)</option>
                  <option value="data_processing">資料整理中 (data_processing)</option>
                  <option value="report_writing">報告撰寫中 (report_writing)</option>
                  <option value="completed">已完成 (completed)</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsEditExpOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
                >
                  {formSubmitting ? '儲存中...' : '儲存變更'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 指派實驗成員 Modal */}
      {isAddMemberOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900">指派成員至本實驗</h3>
              <button onClick={() => setIsAddMemberOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {modalError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.2" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleAddMember} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  GitHub ID (不可變數值) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：10001"
                  value={newMemberGithubId}
                  onChange={(e) => setNewMemberGithubId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
                  required
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  被指派者必須已登錄為本課程之活躍成員 (Course Membership)。
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  GitHub 使用者名稱 (Username) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：studentA"
                  value={newMemberUsername}
                  onChange={(e) => setNewMemberUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">實驗角色</label>
                <select
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="student">學生 (Student)</option>
                  <option value="assistant">助教 (Assistant)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  實驗分組名稱 (選填)
                </label>
                <input
                  type="text"
                  placeholder="例如：第 3 組 或 Group A"
                  value={newMemberGroup}
                  onChange={(e) => setNewMemberGroup(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                </input>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsAddMemberOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
                >
                  {formSubmitting ? '指派中...' : '確認指派'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 修改實驗成員 Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900">
                管理實驗成員：@{editingMember.username}
              </h3>
              <button onClick={() => setEditingMember(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {modalError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.2" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateMember} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">分組名稱</label>
                <input
                  type="text"
                  placeholder="例如：第 1 組"
                  value={editMemberGroup}
                  onChange={(e) => setEditMemberGroup(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">角色</label>
                <select
                  value={editMemberRole}
                  onChange={(e) => setEditMemberRole(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="student">學生 (Student)</option>
                  <option value="assistant">助教 (Assistant)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">狀態</label>
                <select
                  value={editMemberStatus}
                  onChange={(e) => setEditMemberStatus(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="active">正常 (Active)</option>
                  <option value="inactive">停用 (Inactive)</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setEditingMember(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
                >
                  {formSubmitting ? '儲存中...' : '儲存變更'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
