import React, { useState, useEffect } from 'react';
import {
  Course,
  Experiment,
  CourseMembership,
  AuthUser,
  ReportMode,
  ExperimentStatus,
  RepositoryDetailsResponse,
  ActivityLogItem,
} from '../types/index.ts';
import { api, ApiError } from '../api/client.ts';
import {
  ArrowLeft,
  FlaskConical,
  Users,
  Settings,
  Plus,
  ChevronRight,
  ShieldAlert,
  Archive,
  EyeOff,
  UserPlus,
  RefreshCw,
  AlertCircle,
  FolderGit2,
  ExternalLink,
  Activity,
  Trash2,
  CheckCircle2,
  Search,
  AlertTriangle,
  Unlink,
} from 'lucide-react';

interface CourseDetailProps {
  course: Course;
  user: AuthUser | null;
  onBack: () => void;
  onSelectExperiment: (exp: Experiment, initialTab?: 'activity' | 'members' | 'repository' | 'report' | 'files' | 'download') => void;
  onCourseUpdated: (updated: Course) => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

type TabType = 'experiments' | 'members' | 'repository' | 'activity';

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

export const CourseDetail: React.FC<CourseDetailProps> = ({
  course,
  user,
  onBack,
  onSelectExperiment,
  onCourseUpdated,
  onError,
  onSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('experiments');
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [members, setMembers] = useState<CourseMembership[]>([]);
  const [loading, setLoading] = useState(true);

  // 權限判斷：協作者（所有具角色成員）與管理者（教師、助教、建立者）
  const isCollaborator = !!course.role;
  const isManager = Boolean(
    course.role === 'teacher' ||
    course.role === 'assistant' ||
    (user && course.created_by_github_id && String(course.created_by_github_id) === String(user.github_id))
  );

  // Modal 狀態
  const [isEditCourseOpen, setIsEditCourseOpen] = useState(false);
  const [isCreateExpOpen, setIsCreateExpOpen] = useState(false);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<CourseMembership | null>(null);

  // 儲存庫管理狀態
  const [repoDetails, setRepoDetails] = useState<RepositoryDetailsResponse | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [isBindRepoOpen, setIsBindRepoOpen] = useState(false);
  const [isUnbindRepoOpen, setIsUnbindRepoOpen] = useState(false);
  const [isDeleteRepoOpen, setIsDeleteRepoOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [bindRepoName, setBindRepoName] = useState('');
  const [bindRepoDesc, setBindRepoDesc] = useState('');
  const [bindRepoPrivate, setBindRepoPrivate] = useState(false);
  const [bindRepoAutoProvision, setBindRepoAutoProvision] = useState(true);

  // 撤銷協作者確認
  const [revokeConfirmMember, setRevokeConfirmMember] = useState<CourseMembership | null>(null);
  const [revokingMemberId, setRevokingMemberId] = useState<string | null>(null);

  // 活動紀錄狀態
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityActionFilter, setActivityActionFilter] = useState('');
  const [activitySearchKeyword, setActivitySearchKeyword] = useState('');

  // 編輯課程表單
  const [editName, setEditName] = useState(course.name);
  const [editSemester, setEditSemester] = useState(course.semester);
  const [editStatus, setEditStatus] = useState<Course['status']>(course.status);

  // 建立實驗表單
  const [newExpCode, setNewExpCode] = useState('');
  const [newExpName, setNewExpName] = useState('');
  const [newExpRepo, setNewExpRepo] = useState('');
  const [newExpReportMode, setNewExpReportMode] = useState<ReportMode>('shared');

  // 新增成員表單
  const [newMemberUsername, setNewMemberUsername] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'teacher' | 'assistant' | 'student'>('student');

  // 修改成員表單
  const [editMemberRole, setEditMemberRole] = useState<'teacher' | 'assistant' | 'student'>('student');
  const [editMemberStatus, setEditMemberStatus] = useState<'active' | 'inactive' | 'suspended'>('active');

  const [formSubmitting, setFormSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

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
      onError(err.message || '載入課程資料失敗');
    } finally {
      setLoading(false);
    }
  };

  const loadRepoDetails = async () => {
    setRepoLoading(true);
    try {
      const data = await api.courses.getRepository(course.id);
      setRepoDetails(data);
    } catch (err: any) {
      console.error('Failed to load repo details:', err);
    } finally {
      setRepoLoading(false);
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
      console.error('Failed to load activity logs:', err);
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    setEditName(course.name);
    setEditSemester(course.semester);
    setEditStatus(course.status);
    if (activeTab === 'repository') loadRepoDetails();
    if (activeTab === 'activity') loadActivityLogs();
  }, [course.id, activeTab]);

  useEffect(() => {
    if (activeTab === 'activity') {
      loadActivityLogs();
    }
  }, [activityActionFilter, activitySearchKeyword]);

  // 更新課程資訊
  const handleUpdateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setModalError(null);
    try {
      const updated = await api.courses.update(course.id, {
        name: editName.trim(),
        semester: editSemester.trim(),
        status: editStatus,
      });
      onCourseUpdated(updated);
      onSuccess('課程資訊已成功更新');
      setIsEditCourseOpen(false);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        setModalError('衝撞：此課程代碼與學期組合已存在 (409 Conflict)');
      } else {
        setModalError(err.message || '更新課程失敗');
      }
    } finally {
      setFormSubmitting(false);
    }
  };

  // 建立實驗
  const handleCreateExperiment = async (e: React.FormEvent) => {
    e.preventDefault();
    const isCourseMode = course.mode === 'course';
    if (!isCourseMode) {
      const repoRegex = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
      if (!repoRegex.test(newExpRepo.trim())) {
        setModalError('Repository 格式錯誤：必須為 owner/repo (例如：example-org/ee201-lab-01)');
        return;
      }
    }

    setFormSubmitting(true);
    setModalError(null);
    try {
      const created = await api.experiments.create({
        course_id: course.id,
        experiment_code: newExpCode.trim(),
        name: newExpName.trim(),
        repository: isCourseMode ? undefined : newExpRepo.trim(),
        report_mode: newExpReportMode,
      });
      onSuccess(`實驗專案「${created.experiment_code}」建立成功！`);
      setIsCreateExpOpen(false);
      setNewExpCode('');
      setNewExpName('');
      setNewExpRepo('');
      setNewExpReportMode('shared');
      loadData();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        setModalError('衝突：該 Repository 已被其他實驗註冊，或此實驗代碼已存在 (409 Conflict)');
      } else {
        setModalError(err.message || '建立實驗失敗');
      }
    } finally {
      setFormSubmitting(false);
    }
  };

  // 新增成員
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUsername = newMemberUsername.trim().replace(/^@/, '');
    if (!cleanUsername) {
      setModalError('請輸入 GitHub 使用者名稱 (Username)');
      return;
    }

    setFormSubmitting(true);
    setModalError(null);
    try {
      await api.courseMembers.add(course.id, {
        username: cleanUsername,
        role: newMemberRole,
      });
      onSuccess(`成功將 @${cleanUsername} 加入課程！`);
      setIsAddMemberOpen(false);
      setNewMemberUsername('');
      setNewMemberRole('student');
      loadData();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 404) {
        setModalError(err.message || `找不到 GitHub 使用者 @${cleanUsername}，請確認帳號名稱是否正確`);
      } else if (err instanceof ApiError && err.status === 429) {
        setModalError('GitHub API 請求頻率已達上限，請稍後再試');
      } else if (err instanceof ApiError && err.status === 409) {
        setModalError('該 GitHub 使用者已是本課程成員 (409 Conflict)');
      } else {
        setModalError(err.message || '新增成員失敗');
      }
    } finally {
      setFormSubmitting(false);
    }
  };

  // 編輯成員
  const handleUpdateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;

    setFormSubmitting(true);
    setModalError(null);
    try {
      await api.courseMembers.update(course.id, editingMember.id, {
        role: editMemberRole,
        status: editMemberStatus,
      });
      onSuccess(`已更新 @${editingMember.username} 的成員設定`);
      setEditingMember(null);
      loadData();
    } catch (err: any) {
      setModalError(err.message || '更新成員失敗');
    } finally {
      setFormSubmitting(false);
    }
  };

  const [syncingMemberId, setSyncingMemberId] = useState<string | null>(null);

  const handleRetrySync = async (member: CourseMembership) => {
    setSyncingMemberId(member.id);
    try {
      const res = await api.courseMembers.sync(course.id, member.id);
      if (res.sync?.status === 'ready') {
        onSuccess(`成功為 @${member.username} 同步 GitHub 協作者權限！`);
      } else if (res.sync?.status === 'failed') {
        onError(res.sync.error || '同步失敗');
      }
      loadData();
    } catch (err: any) {
      onError(err.message || '重試同步失敗');
    } finally {
      setSyncingMemberId(null);
    }
  };

  const handleBindRepository = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setModalError(null);
    try {
      const res = await api.courses.bindRepository(course.id, {
        repository: bindRepoName.includes('/') ? bindRepoName.trim() : undefined,
        name: !bindRepoName.includes('/') ? bindRepoName.trim() : undefined,
        description: bindRepoDesc.trim(),
        private: bindRepoPrivate,
        auto_provision: bindRepoAutoProvision,
      });
      onSuccess(`成功綁定儲存庫: ${res.repository}`);
      setIsBindRepoOpen(false);
      onCourseUpdated(res.course);
      loadRepoDetails();
    } catch (err: any) {
      setModalError(err.message || '綁定儲存庫失敗');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleUnbindRepository = async () => {
    setFormSubmitting(true);
    try {
      await api.courses.unbindRepository(course.id);
      onSuccess('已成功解除儲存庫綁定（遠端儲存庫完好保留）');
      setIsUnbindRepoOpen(false);
      onCourseUpdated({ ...course, github_repository: null });
      loadRepoDetails();
    } catch (err: any) {
      onError(err.message || '解除綁定失敗');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteRepository = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setModalError(null);
    try {
      await api.courses.deleteRepository(course.id, deleteConfirmText.trim());
      onSuccess('遠端儲存庫已成功刪除');
      setIsDeleteRepoOpen(false);
      setDeleteConfirmText('');
      onCourseUpdated({ ...course, github_repository: null });
      loadRepoDetails();
    } catch (err: any) {
      setModalError(err.message || '刪除儲存庫失敗');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleRevokeCollaborator = async (member: CourseMembership) => {
    setRevokingMemberId(member.id);
    try {
      const res = await api.courseMembers.revoke(course.id, member.id);
      if (res.revoke?.retained) {
        onSuccess(`@${member.username} 在其他課程或實驗仍有使用此儲存庫，系統已安全保留其 GitHub 協作者權限 (Safe Retention)`);
      } else {
        onSuccess(`已成功自 GitHub 儲存庫撤銷 @${member.username} 的協作者權限`);
      }
      setRevokeConfirmMember(null);
      loadData();
    } catch (err: any) {
      onError(err.message || '撤銷協作者權限失敗');
    } finally {
      setRevokingMemberId(null);
    }
  };

  const handleQuickDeactivate = async (member: CourseMembership) => {
    try {
      await api.courseMembers.update(course.id, member.id, {
        status: 'inactive',
      });
      onSuccess(`已將 @${member.username} 從課程成員名單移除 (狀態設為 inactive)`);
      loadData();
    } catch (err: any) {
      onError(err.message || '移除成員失敗');
    }
  };

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
    }
  };

  const renderProvBadge = (status?: string) => {
    switch (status) {
      case 'ready':
        return (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
            Repo 就緒
          </span>
        );
      case 'creating':
        return (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
            Repo 建立中
          </span>
        );
      case 'failed':
        return (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
            Repo 失敗
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
            待建 Repo
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* 頂部資訊列 */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-800 transition-colors cursor-pointer mt-1"
              title="返回課程列表"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-mono font-bold bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded">
                  {course.course_code}
                </span>
                <span className="text-xs font-mono text-slate-500 font-semibold">
                  {course.semester}
                </span>
                {getStatusBadge(course.status)}
                {course.role && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200">
                    我的身分：協作者 ({course.role})
                  </span>
                )}
              </div>

              <h2 className="text-2xl font-bold text-slate-900 mt-1.5">{course.name}</h2>
              <p className="text-xs text-slate-400 mt-1">
                課程 ID：<span className="font-mono">{course.id}</span> • 建立日期：{course.created_at?.slice(0, 10)}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 self-end md:self-auto">
            <button
              onClick={loadData}
              disabled={loading}
              className="p-2 border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-600 transition-colors cursor-pointer disabled:opacity-50"
              title="重新整理"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {isManager && (
              <button
                onClick={() => {
                  setModalError(null);
                  setIsEditCourseOpen(true);
                }}
                className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg transition-colors cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>課程設定</span>
              </button>
            )}
          </div>
        </div>

        {/* 狀態提示橫幅 */}
        {course.status === 'archived' && (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-center space-x-2">
            <Archive className="w-4 h-4 text-amber-600 shrink-0" />
            <span>此課程已封存。依系統規則，所有歷史實驗報告均為唯讀檢視，無法再提交變更或新增實驗。</span>
          </div>
        )}
        {course.status === 'inactive' && (
          <div className="mt-4 bg-slate-100 border border-slate-300 rounded-lg p-3 text-xs text-slate-700 flex items-center space-x-2">
            <EyeOff className="w-4 h-4 text-slate-500 shrink-0" />
            <span>此課程已停用，目前處於隱藏模式，未加入的成員無法查看此課程或其所屬實驗。</span>
          </div>
        )}

        {/* 分頁導覽 */}
        <div className="flex border-b border-slate-200 mt-6 -mb-6 space-x-1">
          <button
            onClick={() => setActiveTab('experiments')}
            className={`flex items-center space-x-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'experiments'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            <FlaskConical className="w-4 h-4" />
            <span>實驗專案 ({experiments.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('members')}
            className={`flex items-center space-x-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'members'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>課程成員 ({members.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('repository')}
            className={`flex items-center space-x-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'repository'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            <FolderGit2 className="w-4 h-4" />
            <span>儲存庫管理</span>
          </button>

          <button
            onClick={() => setActiveTab('activity')}
            className={`flex items-center space-x-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'activity'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>活動與稽核紀錄</span>
          </button>
        </div>
      </div>

      {/* 分頁一：實驗專案列表 */}
      {activeTab === 'experiments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {course.mode === 'course'
                ? `課程模式：共用儲存庫 ${course.github_repository || ''}，為各實驗提供專屬工作空間。`
                : '實驗模式：各實驗專案各自綁定獨立的 GitHub Repository 與 Git 工作區。'}
            </p>

            {isManager && course.status === 'active' && (
              <button
                onClick={() => {
                  setModalError(null);
                  setIsCreateExpOpen(true);
                }}
                className="inline-flex items-center space-x-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-lg transition-colors cursor-pointer shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>建立新實驗專案</span>
              </button>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3 animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-1/4"></div>
                  <div className="h-5 bg-slate-200 rounded w-3/4"></div>
                  <div className="h-3 bg-slate-200 rounded w-1/2"></div>
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
                    onClick={() => onSelectExperiment(exp, 'files')}
                    className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md hover:border-blue-400 transition-all cursor-pointer flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-mono">
                            {exp.experiment_code}
                          </span>
                          {renderProvBadge(exp.provisioning_status)}
                        </div>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusInfo.badgeClass}`}>
                          {statusInfo.icon} {statusInfo.label}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                        {exp.name}
                      </h3>

                      <p className="text-xs text-slate-400 font-mono mt-1 flex items-center space-x-1">
                        <FolderGit2 className="w-3 h-3 shrink-0" />
                        <span className="truncate">
                          {course.mode === 'course'
                            ? course.github_repository
                            : (exp.repository || '未綁定')}
                        </span>
                      </p>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                        <span className="bg-slate-50 border border-slate-200 px-2 py-0.5 rounded text-[11px]">
                          {exp.report_mode === 'shared' ? '共同報告模式' : '個別報告模式'}
                        </span>
                        <span className="text-slate-400">Template v{exp.config_version}</span>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-blue-600 font-semibold">
                      <span>開啟實驗工作區</span>
                      <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-dashed border-slate-200 py-12 text-center space-y-2">
              <FlaskConical className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-sm font-semibold text-slate-700">此課程目前尚未建立任何實驗專案</p>
              <p className="text-xs text-slate-400">
                {isCollaborator
                  ? '點擊右上角「建立新實驗專案」新增課堂實驗，並指定專屬 GitHub Repository。'
                  : '目前尚未建立本課程之實驗項目。'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 分頁二：課程成員管理 */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              課程成員名單作為 Web 權限唯一的權威依據（D1 Course Membership Authority）。
            </p>

            {isManager && course.status === 'active' && (
              <button
                onClick={() => {
                  setModalError(null);
                  setIsAddMemberOpen(true);
                }}
                className="inline-flex items-center space-x-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-lg transition-colors cursor-pointer shadow-sm"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>新增成員</span>
              </button>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3">GitHub 使用者</th>
                    <th className="px-5 py-3">不可變 GitHub ID</th>
                    <th className="px-5 py-3">課程角色</th>
                    <th className="px-5 py-3">狀態</th>
                    <th className="px-5 py-3">GitHub 權限</th>
                    <th className="px-5 py-3">加入時間</th>
                    {isManager && <th className="px-5 py-3 text-right">操作</th>}
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
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                            {m.role === 'teacher' ? '教師' : m.role === 'assistant' ? '助教' : '學生'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          {m.status === 'active' && (
                            <span className="inline-flex items-center space-x-1 text-xs text-emerald-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              <span>正常 (active)</span>
                            </span>
                          )}
                          {m.status === 'inactive' && (
                            <span className="inline-flex items-center space-x-1 text-xs text-slate-500">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                              <span>停用 (inactive)</span>
                            </span>
                          )}
                          {m.status === 'suspended' && (
                            <span className="inline-flex items-center space-x-1 text-xs text-red-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                              <span>停權 (suspended)</span>
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {m.role !== 'student' ? (
                            <span className="text-xs text-slate-400" title="非學生，毋須 GitHub 協作者權限">
                              —
                            </span>
                          ) : m.github_permission_status === 'ready' ? (
                            <span
                              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
                              title={m.github_synced_at ? `已於 ${m.github_synced_at.slice(0, 19).replace('T', ' ')} 同步 push 權限` : '已同步 push 權限'}
                            >
                              <span>✓ 已同步</span>
                            </span>
                          ) : m.github_permission_status === 'pending' ? (
                            <div className="inline-flex items-center space-x-1.5">
                              <span
                                className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200"
                                title="正在向 GitHub 同步協作者權限"
                              >
                                <RefreshCw className={`w-3 h-3 ${syncingMemberId === m.id ? 'animate-spin' : ''}`} />
                                <span>{syncingMemberId === m.id ? '同步處理中' : '待同步 / 同步中'}</span>
                              </span>
                              {isManager && (
                                <button
                                  onClick={() => handleRetrySync(m)}
                                  disabled={syncingMemberId === m.id}
                                  className="text-xs text-blue-600 hover:text-blue-800 underline disabled:opacity-50 cursor-pointer"
                                  title="若同步狀態長時間停滯，點擊手動觸發 GitHub 協作者同步"
                                >
                                  {syncingMemberId === m.id ? '同步中...' : '重新同步'}
                                </button>
                              )}
                            </div>
                          ) : m.github_permission_status === 'failed' ? (
                            <div className="inline-flex items-center space-x-1.5">
                              <span
                                className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-700 border border-red-200 cursor-help"
                                title={m.github_permission_error || 'GitHub 協作者同步失敗'}
                              >
                                <span>✗ 同步失敗</span>
                              </span>
                              {isManager && (
                                <button
                                  onClick={() => handleRetrySync(m)}
                                  disabled={syncingMemberId === m.id}
                                  className="text-xs text-blue-600 hover:text-blue-800 underline disabled:opacity-50 cursor-pointer"
                                  title="點擊重新同步 GitHub 協作者權限"
                                >
                                  {syncingMemberId === m.id ? '同步中...' : '重試'}
                                </button>
                              )}
                            </div>
                          ) : m.github_permission_status === 'removed' ? (
                            <span
                              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200"
                              title="已從 GitHub Repository 協作者名單移除"
                            >
                              <span>— 已移除</span>
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">待同步</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-400">
                          {m.created_at?.slice(0, 10)}
                        </td>
                        {isManager && (
                          <td className="px-5 py-3.5 text-right whitespace-nowrap space-x-2">
                            <button
                              onClick={() => {
                                setEditingMember(m);
                                setEditMemberRole(m.role as any);
                                setEditMemberStatus(m.status as any);
                                setModalError(null);
                              }}
                              className="text-xs font-semibold text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 transition-colors cursor-pointer"
                              title="修改成員角色或狀態"
                            >
                              編輯
                            </button>
                            {m.status === 'active' && (
                              <button
                                onClick={() => handleQuickDeactivate(m)}
                                className="text-xs font-semibold text-amber-600 hover:text-amber-800 p-1 rounded hover:bg-amber-50 transition-colors cursor-pointer"
                                title="從課程名單移除 (設為停用，不影響歷史紀錄)"
                              >
                                從名單移除
                              </button>
                            )}
                            {m.role === 'student' && m.github_permission_status === 'ready' && course.github_repository && (
                              <button
                                onClick={() => setRevokeConfirmMember(m)}
                                disabled={revokingMemberId === m.id}
                                className="text-xs font-semibold text-rose-600 hover:text-rose-800 p-1 rounded hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-50"
                                title="從 GitHub 儲存庫撤銷協作者權限 (具備多課程保護 Safe Retention)"
                              >
                                {revokingMemberId === m.id ? '撤銷中...' : '撤銷 GitHub 權限'}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {members.length === 0 && (
                    <tr>
                      <td colSpan={isManager ? 7 : 6} className="text-center py-8 text-slate-400 text-xs">
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

      {/* 分頁三：儲存庫管理 */}
      {activeTab === 'repository' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-100 pb-4 gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <FolderGit2 className="w-5 h-5 text-blue-600" />
                  <span>課程儲存庫配置 (Course Repository)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {course.mode === 'course'
                    ? 'Course Mode 架構：所有實驗專案共用一個課程儲存庫，各實驗以目錄（Scoped Path）劃分獨立工作區。'
                    : 'Experiment Mode 架構：本課程採各實驗獨立儲存庫模式，您可以在各實驗專案中分別配置專屬 Repository。'}
                </p>
              </div>
              <button
                onClick={loadRepoDetails}
                disabled={repoLoading}
                className="inline-flex items-center space-x-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer self-start md:self-auto"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${repoLoading ? 'animate-spin' : ''}`} />
                <span>重新整理遠端資訊</span>
              </button>
            </div>

            {course.github_repository ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">儲存庫全名</span>
                    <div className="flex items-center space-x-2">
                      <span className="text-base font-mono font-bold text-slate-900">{course.github_repository}</span>
                      <a
                        href={`https://github.com/${course.github_repository}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800"
                        title="在 GitHub 上開啟"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">遠端同步狀態</span>
                    <div>
                      {repoLoading ? (
                        <span className="text-xs text-slate-500">正在查驗遠端狀態...</span>
                      ) : repoDetails?.remote_exists ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>GitHub 遠端連線正常 ({repoDetails.remote?.private ? 'Private 私人' : 'Public 公開'})</span>
                        </span>
                      ) : repoDetails?.remote_error ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-semibold bg-red-50 text-red-700 border border-red-200" title={repoDetails.remote_error}>
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>遠端查驗異常: {repoDetails.remote_error}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          <span>已綁定，待確認遠端狀態</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {repoDetails?.remote && (
                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-1 font-mono">
                    <div>預設分支：{repoDetails.remote.default_branch}</div>
                    {repoDetails.remote.description && <div>描述：{repoDetails.remote.description}</div>}
                    <div>最後更新：{repoDetails.remote.updated_at ? new Date(repoDetails.remote.updated_at).toLocaleString() : '—'}</div>
                  </div>
                )}

                {isManager && (
                  <div className="border-t border-slate-200 pt-4 flex flex-wrap items-center gap-3 justify-end">
                    <button
                      onClick={() => setIsUnbindRepoOpen(true)}
                      className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-lg transition-colors cursor-pointer"
                      title="僅清空系統綁定，不刪除 GitHub 上的儲存庫與提交檔案"
                    >
                      <Unlink className="w-3.5 h-3.5 text-slate-500" />
                      <span>解除綁定 (Unbind)</span>
                    </button>
                    <button
                      onClick={() => {
                        setDeleteConfirmText('');
                        setModalError(null);
                        setIsDeleteRepoOpen(true);
                      }}
                      className="inline-flex items-center space-x-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-3.5 py-2 rounded-lg transition-colors cursor-pointer"
                      title="呼叫 GitHub API 永久刪除此遠端儲存庫 (危險操作，需輸入全名二次確認)"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-600" />
                      <span>刪除遠端儲存庫 (Delete)</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 space-y-4">
                <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                  <FolderGit2 className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-slate-900">尚未綁定 GitHub 儲存庫</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    綁定儲存庫後，系統將自動為本課程學生同步 GitHub 協作者權限，並啟用完整的 Git 工作區與檔案協作功能。
                  </p>
                </div>
                {isManager && (
                  <button
                    onClick={() => {
                      setBindRepoName('');
                      setBindRepoDesc(`Course workspace for ${course.name || course.course_code}`);
                      setBindRepoPrivate(false);
                      setBindRepoAutoProvision(true);
                      setModalError(null);
                      setIsBindRepoOpen(true);
                    }}
                    className="inline-flex items-center space-x-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors cursor-pointer shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>建立並綁定儲存庫</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 分頁四：活動與稽核紀錄 */}
      {activeTab === 'activity' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center space-x-1 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="搜尋摘要或目標..."
                  value={activitySearchKeyword}
                  onChange={(e) => setActivitySearchKeyword(e.target.value)}
                  className="bg-transparent border-none outline-none text-slate-700 placeholder-slate-400 w-32 md:w-48 text-xs"
                />
              </div>

              <select
                value={activityActionFilter}
                onChange={(e) => setActivityActionFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-slate-700 text-xs"
              >
                <option value="">全部動作類型</option>
                <option value="file_created">建立檔案 (file_created)</option>
                <option value="file_modified">更新檔案 (file_modified)</option>
                <option value="file_deleted">刪除檔案 (file_deleted)</option>
                <option value="member_added">新增成員 (member_added)</option>
                <option value="collaborator_revoked">撤銷協作者 (collaborator_revoked)</option>
                <option value="repository_bound">綁定儲存庫 (repository_bound)</option>
                <option value="repository_unbound">解除綁定 (repository_unbound)</option>
                <option value="remote_repository_deleted">刪除遠端庫 (remote_repository_deleted)</option>
              </select>
            </div>

            <button
              onClick={loadActivityLogs}
              disabled={activityLoading}
              className="inline-flex items-center space-x-1 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${activityLoading ? 'animate-spin' : ''}`} />
              <span>重新整理</span>
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="divide-y divide-slate-100">
              {activityLogs.map((log) => {
                let details: any = null;
                try {
                  if (log.details_json) details = JSON.parse(log.details_json);
                } catch {}

                const isBotDelegated = details?.execution_mode === 'bot_delegated';
                const initiator = details?.initiated_by?.username;

                return (
                  <div key={log.id} className="p-4 hover:bg-slate-50/80 transition-colors space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-slate-900">@{log.actor_name || log.actor_id}</span>
                        <span className="text-slate-400">•</span>
                        <span className="font-mono text-slate-500">{new Date(log.timestamp).toLocaleString()}</span>
                        {isBotDelegated && (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                            <span>🤖 GitHub App Bot 代為執行</span>
                            {initiator && <span>(發起者: @{initiator})</span>}
                          </span>
                        )}
                      </div>
                      <span className="px-2 py-0.5 rounded font-mono text-[10px] font-semibold bg-slate-100 text-slate-600">
                        {log.action}
                      </span>
                    </div>

                    <div className="text-sm text-slate-800">{log.summary}</div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-mono">
                      {log.repo_name && <span>儲存庫: {log.repo_name}</span>}
                      {log.target && <span>目標: {log.target}</span>}
                      {log.commit_sha && (
                        <span className="text-blue-600">
                          Commit: {log.commit_sha.slice(0, 7)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {activityLogs.length === 0 && (
                <div className="text-center py-12 text-slate-400 text-xs">
                  {activityLoading ? '載入中...' : '尚無符合條件的活動紀錄'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 編輯課程 Modal */}
      {isEditCourseOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900">編輯課程設定</h3>
              <button onClick={() => setIsEditCourseOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {modalError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.2" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateCourse} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">課程名稱</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">開課學期</label>
                <input
                  type="text"
                  value={editSemester}
                  onChange={(e) => setEditSemester(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">課程狀態</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white"
                >
                  <option value="active">進行中 (Active)</option>
                  <option value="archived">已封存 (Archived - 唯讀查看)</option>
                  <option value="inactive">已停用 (Inactive - 僅協作者可見)</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  封存後將關閉所有寫入權限；停用後僅本課程協作者可見。
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsEditCourseOpen(false)}
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

      {/* 建立新實驗專案 Modal */}
      {isCreateExpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900">建立新實驗專案</h3>
              <button onClick={() => setIsCreateExpOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {modalError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.2" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateExperiment} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  實驗代碼 (Experiment Code) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：lab-01 或 exp-bjt"
                  value={newExpCode}
                  onChange={(e) => setNewExpCode(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  實驗名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：BJT 雙極性電晶體偏壓與特性量測"
                  value={newExpName}
                  onChange={(e) => setNewExpName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              {course.mode === 'course' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    共用課程儲存庫 (Course Repository)
                  </label>
                  <div className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-mono text-sm">
                    {course.github_repository || '尚未綁定'}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    課程模式下，所有實驗共用此儲存庫。系統會自動建立本實驗的專屬工作空間。
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    GitHub Repository (owner/repo) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="例如：example-org/ee201-lab-01"
                    value={newExpRepo}
                    onChange={(e) => setNewExpRepo(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
                    required
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    實驗模式：一節課一 Repo 唯一綁定。建立實驗後，協作者可於實驗詳情頁一鍵透過 GitHub App 初始化遠端儲存庫。
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">報告撰寫模式</label>
                <select
                  value={newExpReportMode}
                  onChange={(e) => setNewExpReportMode(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="shared">共同報告模式 (Shared - 全組共編 report.md)</option>
                  <option value="separate">個別報告模式 (Separate - 依 GitHub ID 各自編寫)</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsCreateExpOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
                >
                  {formSubmitting ? '建立中...' : '確認建立'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 新增課程成員 Modal */}
      {isAddMemberOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900">新增課程成員</h3>
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
                  GitHub 使用者名稱 (Username) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-mono text-sm">@</span>
                  <input
                    type="text"
                    placeholder="例如：octocat 或 studentA"
                    value={newMemberUsername}
                    onChange={(e) => setNewMemberUsername(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
                    required
                    autoFocus
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  系統將自動透過 GitHub 驗證該帳號並取得不可變數字 ID，使用者登入後即可存取本課程。
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">協作者權限</label>
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  所有加入課程的成員均為平等協作者。
                </p>
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
                  {formSubmitting ? '新增中...' : '確認新增'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 修改成員權限 Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900">
                管理協作者狀態：@{editingMember.username}
              </h3>
              <button onClick={() => setEditingMember(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {modalError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 flex items-start space-x-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.2" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateMember} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">協作者權限</label>
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  所有協作者使用相同的 Workspace 操作權限。
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">帳號狀態</label>
                <select
                  value={editMemberStatus}
                  onChange={(e) => setEditMemberStatus(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="active">正常 (Active)</option>
                  <option value="inactive">停用 (Inactive)</option>
                  <option value="suspended">停權 (Suspended)</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  只調整此協作者是否仍可存取課程工作區。
                </p>
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

      {/* 建立 / 綁定儲存庫 Modal */}
      {isBindRepoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                <FolderGit2 className="w-5 h-5 text-blue-600" />
                <span>配置課程儲存庫</span>
              </h3>
              <button onClick={() => setIsBindRepoOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {modalError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.2" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleBindRepository} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  儲存庫名稱或全名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：course-lab-repo 或 owner/repo"
                  value={bindRepoName}
                  onChange={(e) => setBindRepoName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-mono text-xs"
                  required
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  若輸入單純名稱，系統將自動加上授權之 Organization/Owner 前綴。
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">儲存庫描述</label>
                <input
                  type="text"
                  placeholder="簡短描述"
                  value={bindRepoDesc}
                  onChange={(e) => setBindRepoDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-xs"
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bindRepoPrivate}
                    onChange={(e) => setBindRepoPrivate(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span>設為私人儲存庫 (Private Repository)</span>
                </label>

                <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bindRepoAutoProvision}
                    onChange={(e) => setBindRepoAutoProvision(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span>若儲存庫不存在，透過 GitHub App 自動在 GitHub 建立</span>
                </label>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsBindRepoOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
                >
                  {formSubmitting ? '處理中...' : '確認綁定'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 解除綁定 Modal */}
      {isUnbindRepoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                <Unlink className="w-5 h-5 text-amber-600" />
                <span>解除儲存庫綁定 (Unbind)</span>
              </h3>
              <button onClick={() => setIsUnbindRepoOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1">
              <div className="font-semibold">⚠️ 這是安全解除綁定操作</div>
              <p>
                解除綁定只會清除系統資料庫中的儲存庫關聯，<strong>絕對不會刪除</strong> GitHub 上的實際儲存庫、Commit 歷程或檔案內容。歷史活動紀錄亦完整保留。
              </p>
            </div>

            <p className="text-xs text-slate-600">
              目前綁定之儲存庫：<span className="font-mono font-bold text-slate-900">{course.github_repository}</span>
            </p>

            <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setIsUnbindRepoOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleUnbindRepository}
                disabled={formSubmitting}
                className="px-4 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50"
              >
                {formSubmitting ? '解除中...' : '確認解除綁定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 刪除遠端儲存庫 Modal (危險操作，需輸入全名二次確認) */}
      {isDeleteRepoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-red-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-red-100 pb-3">
              <h3 className="text-lg font-bold text-red-600 flex items-center space-x-2">
                <Trash2 className="w-5 h-5 text-red-600" />
                <span>危險操作：刪除遠端儲存庫</span>
              </h3>
              <button onClick={() => setIsDeleteRepoOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {modalError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.2" />
                <span>{modalError}</span>
              </div>
            )}

            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 space-y-1">
              <div className="font-semibold">🚨 此操作無法復原！</div>
              <p>
                系統將呼叫 GitHub API 永久刪除儲存庫 <strong>{course.github_repository}</strong> 及其所有分支、Commit 與檔案。
              </p>
              <p className="text-[11px] text-red-700 mt-1">
                若 GitHub App 未被賦予 Administration: write 權限 (HTTP 403)，系統將誠實回報失敗並提供手動刪除指引，絕不會偽造成功。
              </p>
            </div>

            <form onSubmit={handleDeleteRepository} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  請輸入完整的儲存庫全名以確認刪除：
                </label>
                <div className="bg-slate-100 px-3 py-1.5 rounded font-mono text-xs text-slate-700 mb-2 select-all">
                  {course.github_repository}
                </div>
                <input
                  type="text"
                  placeholder="請在此處輸入上方完整名稱"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-red-500 font-mono text-xs"
                  required
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsDeleteRepoOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting || deleteConfirmText.trim() !== course.github_repository}
                  className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-40 cursor-pointer"
                >
                  {formSubmitting ? '刪除中...' : '確認永久刪除遠端儲存庫'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 撤銷 GitHub 協作者權限確認 Modal */}
      {revokeConfirmMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                <ShieldAlert className="w-5 h-5 text-rose-600" />
                <span>撤銷 GitHub 協作者權限</span>
              </h3>
              <button onClick={() => setRevokeConfirmMember(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="space-y-3 text-xs text-slate-600">
              <p>
                確定要撤銷 <strong>@{revokeConfirmMember.username}</strong> (ID: {revokeConfirmMember.github_id}) 在儲存庫 <strong>{course.github_repository}</strong> 的協作者權限嗎？
              </p>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-800 space-y-1">
                <div className="font-semibold">🛡️ 多課程安全保留保護 (Safe Retention)</div>
                <p>
                  若該學生在其他進行中的課程或實驗仍共用此儲存庫，系統將自動安全保留其權限，避免意外中斷其他課程之進行。
                </p>
                <p className="text-[11px] text-blue-700 mt-1">
                  撤銷協作者權限<strong>絕不會</strong>刪除該學生的歷史 Commit、工作區檔案或活動紀錄。
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setRevokeConfirmMember(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => handleRevokeCollaborator(revokeConfirmMember)}
                disabled={revokingMemberId === revokeConfirmMember.id}
                className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg disabled:opacity-50"
              >
                {revokingMemberId === revokeConfirmMember.id ? '撤銷中...' : '確認撤銷協作者權限'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
