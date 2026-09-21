import React, { useState, useEffect } from 'react';
import {
  Course,
  Experiment,
  CourseMembership,
  AuthUser,
  ReportMode,
  ExperimentStatus,
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
} from 'lucide-react';

interface CourseDetailProps {
  course: Course;
  user: AuthUser | null;
  onBack: () => void;
  onSelectExperiment: (exp: Experiment, initialTab?: 'activity' | 'members' | 'report' | 'files' | 'upload' | 'download' | 'agent') => void;
  onCourseUpdated: (updated: Course) => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

type TabType = 'experiments' | 'members';

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

  // 權限判斷：只要是課程成員（擁有 active 角色），皆具備協作者操作與管理權限
  const isCollaborator = !!course.role;

  // Modal 狀態
  const [isEditCourseOpen, setIsEditCourseOpen] = useState(false);
  const [isCreateExpOpen, setIsCreateExpOpen] = useState(false);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<CourseMembership | null>(null);

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
  const [newMemberGithubId, setNewMemberGithubId] = useState('');
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

  useEffect(() => {
    loadData();
    setEditName(course.name);
    setEditSemester(course.semester);
    setEditStatus(course.status);
  }, [course.id]);

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
    if (!newMemberGithubId.trim() || !newMemberUsername.trim()) {
      setModalError('請輸入 GitHub ID (數值) 與使用者名稱');
      return;
    }

    setFormSubmitting(true);
    setModalError(null);
    try {
      await api.courseMembers.add(course.id, {
        github_id: newMemberGithubId.trim(),
        username: newMemberUsername.trim(),
        role: newMemberRole,
      });
      onSuccess(`成功將 @${newMemberUsername.trim()} 加入課程！`);
      setIsAddMemberOpen(false);
      setNewMemberGithubId('');
      setNewMemberUsername('');
      setNewMemberRole('student');
      loadData();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
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
    if (course.mode === 'course') {
      return null;
    }
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

            {isCollaborator && (
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

            {isCollaborator && course.status === 'active' && (
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

            {isCollaborator && course.status === 'active' && (
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
                    <th className="px-5 py-3">加入時間</th>
                    {isCollaborator && <th className="px-5 py-3 text-right">操作</th>}
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
                            協作者
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
                        <td className="px-5 py-3.5 text-xs text-slate-400">
                          {m.created_at?.slice(0, 10)}
                        </td>
                        {isCollaborator && (
                          <td className="px-5 py-3.5 text-right">
                            <button
                              onClick={() => {
                                setEditingMember(m);
                                setEditMemberRole(m.role as any);
                                setEditMemberStatus(m.status as any);
                                setModalError(null);
                              }}
                              className="text-xs font-semibold text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 transition-colors cursor-pointer"
                            >
                              管理權限
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {members.length === 0 && (
                    <tr>
                      <td colSpan={isCollaborator ? 6 : 5} className="text-center py-8 text-slate-400 text-xs">
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
                  GitHub ID (不可變數值) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如：10001 (數值識別碼)"
                  value={newMemberGithubId}
                  onChange={(e) => setNewMemberGithubId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
                  required
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  系統以此不可變數字識別身分，使用者更改 GitHub username 亦不受影響。
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
    </div>
  );
};
