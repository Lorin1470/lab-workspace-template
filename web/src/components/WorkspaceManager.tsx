import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Experiment,
  Course,
  AuthUser,
  WorkspaceFileItem,
  WorkspaceFileContent,
  WorkspaceWriteResponse,
} from '../types/index.ts';
import { api, ApiError } from '../api/client.ts';
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  Image as ImageIcon,
  Upload,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Lock,
  Edit3,
  Eye,
  Save,
  X,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  ShieldAlert,
  Clock,
  GitCommit,
} from 'lucide-react';

interface WorkspaceManagerProps {
  experiment: Experiment;
  course?: Course | null;
  user: AuthUser | null;
  isCollaborator: boolean;
  onActivityRefresh?: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

interface LastOperationInfo {
  type: 'save' | 'raw' | 'photo';
  action: string;
  path: string;
  commit_sha: string;
  time: string;
}

// 人類友善的錯誤訊息轉譯
export function formatWorkspaceError(err: any, context?: 'raw' | 'photo' | 'save' | 'general'): string {
  const status = err?.status || (err instanceof ApiError ? err.status : 0);
  const msg = String(err?.message || '');

  if (status === 401) {
    return '登入狀態已失效，請重新登入。';
  }
  if (status === 403) {
    if (msg.includes('Raw sanctuary violation')) {
      return '原始數據受到聖域保護，嚴禁任何覆蓋或直接修改。請使用專屬 Raw 上傳功能。';
    }
    if (msg.includes('Separate report isolation violation')) {
      return '此實驗採個人報告模式，你只能編輯自己的個人報告。';
    }
    return '你不是這個實驗 Workspace 的協作者。';
  }
  if (status === 404) {
    return '找不到這個檔案或實驗 Workspace。';
  }
  if (status === 409) {
    if (context === 'raw' || msg.includes('Raw data already exists') || msg.includes('sanctuary')) {
      return '原始資料已存在，Raw Data 不允許覆寫。';
    }
    return '檔案已被其他同學修改，請重新載入最新版本後再編輯。';
  }
  if (status === 413) {
    if (context === 'photo') {
      return '照片不能超過 5MB。';
    }
    return '檔案太大。';
  }
  if (status === 502) {
    return 'GitHub 服務暫時無回應，請稍後再試。';
  }
  if (status >= 500) {
    return 'Workspace 暫時無法使用，請稍後再試。';
  }

  return msg || 'Workspace 暫時無法使用，請稍後再試。';
}

// 格式化檔案大小
function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// 判斷是否為圖片路徑
function isImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.webp')
  );
}

function imageMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

// 判斷是否為 Markdown 路徑
function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

// 極簡純前端 Markdown 預覽元件（不依賴大型套件）
const SimpleMarkdownViewer: React.FC<{ content: string }> = ({ content }) => {
  const renderedLines = useMemo(() => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeBlockLines: string[] = [];
    let codeBlockKey = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('```')) {
        if (inCodeBlock) {
          elements.push(
            <pre
              key={`code-${codeBlockKey++}`}
              className="bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto text-xs font-mono my-2"
            >
              <code>{codeBlockLines.join('\n')}</code>
            </pre>
          );
          codeBlockLines = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockLines.push(line);
        continue;
      }

      // 標題
      if (line.startsWith('# ')) {
        elements.push(
          <h1 key={i} className="text-xl font-bold text-slate-900 border-b border-slate-200 pb-1.5 mt-4 mb-2">
            {line.slice(2)}
          </h1>
        );
      } else if (line.startsWith('## ')) {
        elements.push(
          <h2 key={i} className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-1 mt-3 mb-2">
            {line.slice(3)}
          </h2>
        );
      } else if (line.startsWith('### ')) {
        elements.push(
          <h3 key={i} className="text-base font-semibold text-slate-800 mt-2 mb-1">
            {line.slice(4)}
          </h3>
        );
      } else if (line.startsWith('> ')) {
        elements.push(
          <blockquote key={i} className="border-l-4 border-blue-500 pl-3 py-1 bg-blue-50/50 text-slate-700 text-xs my-2 italic rounded-r">
            {line.slice(2)}
          </blockquote>
        );
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        elements.push(
          <li key={i} className="ml-4 list-disc text-xs text-slate-700 my-0.5">
            {line.slice(2)}
          </li>
        );
      } else if (/^\d+\.\s/.test(line)) {
        const itemText = line.replace(/^\d+\.\s/, '');
        elements.push(
          <li key={i} className="ml-4 list-decimal text-xs text-slate-700 my-0.5">
            {itemText}
          </li>
        );
      } else if (line.trim() === '---' || line.trim() === '***') {
        elements.push(<hr key={i} className="my-3 border-slate-200" />);
      } else if (line.trim() === '') {
        elements.push(<div key={i} className="h-2" />);
      } else {
        elements.push(
          <p key={i} className="text-xs text-slate-700 leading-relaxed my-1">
            {line}
          </p>
        );
      }
    }

    if (inCodeBlock && codeBlockLines.length > 0) {
      elements.push(
        <pre
          key={`code-end`}
          className="bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto text-xs font-mono my-2"
        >
          <code>{codeBlockLines.join('\n')}</code>
        </pre>
      );
    }

    return elements;
  }, [content]);

  return <div className="space-y-1">{renderedLines}</div>;
};

export const WorkspaceManager: React.FC<WorkspaceManagerProps> = ({
  experiment,
  course,
  user,
  isCollaborator,
  onActivityRefresh,
  onError,
  onSuccess,
}) => {
  const repositoryFullName = experiment.repository || course?.github_repository || '';
  const isCourseMode = course?.mode === 'course';
  const getScopedPath = (path: string) =>
    isCourseMode ? `experiments/${experiment.experiment_code}/${path}` : path;

  // 檔案樹狀態
  const [rootItems, setRootItems] = useState<WorkspaceFileItem[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderChildren, setFolderChildren] = useState<Record<string, WorkspaceFileItem[]>>({});
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());

  // 目前開啟之檔案狀態
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<WorkspaceFileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [editorMode, setEditorMode] = useState<'view' | 'edit'>('view');
  const [editContent, setEditContent] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflictOccurred, setConflictOccurred] = useState(false);
  const [copiedSha, setCopiedSha] = useState<string | null>(null);

  // 最近成功操作資訊
  const [lastOperation, setLastOperation] = useState<LastOperationInfo | null>(null);

  // 上傳 Modal 狀態
  const [isRawModalOpen, setIsRawModalOpen] = useState(false);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [rawMessage, setRawMessage] = useState('');
  const [uploadingRaw, setUploadingRaw] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);

  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoMessage, setPhotoMessage] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // 1. 載入根目錄檔案樹
  const loadRootTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const items = await api.workspace.listFiles(experiment.id);
      setRootItems(items);
    } catch (err: any) {
      onError(formatWorkspaceError(err, 'general'));
    } finally {
      setTreeLoading(false);
    }
  }, [experiment.id, onError]);

  useEffect(() => {
    loadRootTree();
  }, [loadRootTree]);

  // 2. 切換資料夾展開 / 收合
  const toggleFolder = async (dirPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });

    // 若尚未快取子項目，進行動態載入
    if (!folderChildren[dirPath]) {
      setLoadingFolders((prev) => new Set(prev).add(dirPath));
      try {
        const children = await api.workspace.listFiles(experiment.id, dirPath);
        setFolderChildren((prev) => ({ ...prev, [dirPath]: children }));
      } catch (err: any) {
        onError(formatWorkspaceError(err, 'general'));
      } finally {
        setLoadingFolders((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    }
  };

  // 3. 讀取單一檔案
  const loadFile = async (filePath: string) => {
    setSelectedPath(filePath);
    setFileLoading(true);
    setConflictOccurred(false);
    try {
      const fileData = await api.workspace.readFile(experiment.id, filePath);
      setCurrentFile(fileData);
      setEditContent(fileData.content || '');
      setEditorMode('view');

      // 設定預設 commit message
      if (filePath.startsWith('report/')) {
        setCommitMessage('更新實驗報告');
      } else {
        setCommitMessage('更新實驗筆記');
      }
    } catch (err: any) {
      setCurrentFile(null);
      onError(formatWorkspaceError(err, 'general'));
    } finally {
      setFileLoading(false);
    }
  };

  // 4. 重新整理整個 Workspace
  const handleRefreshWorkspace = async () => {
    setFolderChildren({});
    setExpandedFolders(new Set());
    await loadRootTree();
    if (selectedPath) {
      await loadFile(selectedPath);
    }
    onSuccess('工作區已重新整理');
  };

  // 5. 檢查當前檔案的編輯權限（包含 Separate Report 模式與 Raw 聖域限制）
  const editPermission = useMemo(() => {
    if (!currentFile) {
      return { allowed: false, reason: '' };
    }
    if (!isCollaborator) {
      return { allowed: false, reason: '你不是這個實驗 Workspace 的協作者，僅供唯讀檢視。' };
    }
    // Raw Data 聖域保護
    if (currentFile.path.startsWith('raw/')) {
      return {
        allowed: false,
        reason: '原始資料受到 Raw Data 聖域保護，嚴禁直接修改。若要新增量測數據請使用「上傳原始資料」。',
      };
    }
    // Separate Report 模式防護
    if (experiment.report_mode === 'separate' && currentFile.path.startsWith('report/')) {
      if (user?.github_id) {
        const userReportPath1 = `report/${user.github_id}.md`;
        const userReportPath2 = `report/report-${user.github_id}.md`;
        if (currentFile.path !== userReportPath1 && currentFile.path !== userReportPath2) {
          return {
            allowed: false,
            reason: '此實驗採個人報告模式，你只能編輯自己的報告。',
          };
        }
      } else {
        return {
          allowed: false,
          reason: '無法驗證個人 GitHub 身分，個人報告僅供唯讀檢視。',
        };
      }
    }

    return { allowed: true, reason: '' };
  }, [currentFile, isCollaborator, experiment.report_mode, user?.github_id]);

  // 6. 儲存檔案並提交 Commit (附帶原始 SHA 與 409 Conflict 良好處理)
  const handleSaveFile = async () => {
    if (!currentFile) return;
    if (!editPermission.allowed) {
      onError(editPermission.reason);
      return;
    }

    setSaving(true);
    setConflictOccurred(false);
    try {
      const res: WorkspaceWriteResponse = await api.workspace.saveFile(experiment.id, {
        path: currentFile.path,
        content: editContent,
        message: commitMessage.trim() || '更新實驗筆記',
        sha: currentFile.sha,
      });

      // 成功：更新檔案 SHA 與狀態
      setCurrentFile((prev) =>
        prev
          ? {
              ...prev,
              content: editContent,
              sha: res.content_sha || prev.sha,
            }
          : null
      );

      setLastOperation({
        type: 'save',
        action: res.action,
        path: res.path,
        commit_sha: res.commit_sha,
        time: new Date().toLocaleTimeString(),
      });

      onSuccess(`儲存成功！Commit: ${res.commit_sha.slice(0, 7)}`);
      onActivityRefresh?.();
      setEditorMode('view');
    } catch (err: any) {
      const status = err?.status || (err instanceof ApiError ? err.status : 0);
      if (status === 409 || String(err?.message || '').includes('409') || String(err?.message || '').includes('conflict')) {
        setConflictOccurred(true);
        onError('這個檔案已經被其他同學修改，請重新載入最新版本後再編輯。');
      } else {
        onError(formatWorkspaceError(err, 'save'));
      }
    } finally {
      setSaving(false);
    }
  };

  // 7. 409 衝突重新載入
  const handleReloadConflictFile = async () => {
    if (!currentFile) return;
    await loadFile(currentFile.path);
    setConflictOccurred(false);
    onSuccess('已重新載入最新版本檔案內容');
  };

  // 8. 上傳原始資料 (Raw Data Sanctuary)
  const handleUploadRawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawFile) {
      setRawError('請選擇要上傳的資料檔案');
      return;
    }

    setUploadingRaw(true);
    setRawError(null);
    try {
      const formData = new FormData();
      formData.append('file', rawFile);
      formData.append('message', rawMessage.trim() || `upload: raw/${rawFile.name}`);

      const res = await api.workspace.uploadRaw(experiment.id, formData);

      setLastOperation({
        type: 'raw',
        action: res.action,
        path: res.path,
        commit_sha: res.commit_sha,
        time: new Date().toLocaleTimeString(),
      });

      onSuccess(`原始資料上傳成功！Commit: ${res.commit_sha.slice(0, 7)}`);
      onActivityRefresh?.();
      setIsRawModalOpen(false);
      setRawFile(null);
      setRawMessage('');

      // 重新整理檔案樹
      await handleRefreshWorkspace();
    } catch (err: any) {
      const status = err?.status || (err instanceof ApiError ? err.status : 0);
      if (status === 409) {
        setRawError('原始資料已存在，Raw Data 不允許覆寫。');
      } else if (status === 413) {
        setRawError('檔案太大。');
      } else {
        setRawError(formatWorkspaceError(err, 'raw'));
      }
    } finally {
      setUploadingRaw(false);
    }
  };

  // 9. 上傳實驗照片
  const handleUploadPhotoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoFile) {
      setPhotoError('請選擇要上傳的圖片檔案');
      return;
    }

    // 前端嚴格限制 5MB
    if (photoFile.size > 5 * 1024 * 1024) {
      setPhotoError('照片不能超過 5MB。');
      return;
    }

    setUploadingPhoto(true);
    setPhotoError(null);
    try {
      const formData = new FormData();
      formData.append('file', photoFile);
      formData.append('message', photoMessage.trim() || `upload: photos/${photoFile.name}`);

      const res = await api.workspace.uploadPhoto(experiment.id, formData);

      setLastOperation({
        type: 'photo',
        action: res.action,
        path: res.path,
        commit_sha: res.commit_sha,
        time: new Date().toLocaleTimeString(),
      });

      onSuccess(`照片上傳成功！Commit: ${res.commit_sha.slice(0, 7)}`);
      onActivityRefresh?.();
      setIsPhotoModalOpen(false);
      setPhotoFile(null);
      setPhotoPreviewUrl(null);
      setPhotoMessage('');

      // 重新整理檔案樹
      await handleRefreshWorkspace();
    } catch (err: any) {
      const status = err?.status || (err instanceof ApiError ? err.status : 0);
      if (status === 413) {
        setPhotoError('檔案太大。');
      } else {
        setPhotoError(formatWorkspaceError(err, 'photo'));
      }
    } finally {
      setUploadingPhoto(false);
    }
  };

  // 複製 SHA 輔助
  const handleCopySha = (sha: string) => {
    navigator.clipboard.writeText(sha);
    setCopiedSha(sha);
    setTimeout(() => setCopiedSha(null), 2000);
  };

  // 遞迴渲染檔案項目
  const renderTreeItem = (item: WorkspaceFileItem, depth = 0) => {
    const isDir = item.type === 'dir' || (item.type as string) === 'directory';
    const isExpanded = expandedFolders.has(item.path);
    const isLoading = loadingFolders.has(item.path);
    const isSelected = selectedPath === item.path;
    const isRawDir = item.path === 'raw' || item.path.startsWith('raw/');

    return (
      <div key={item.path} className="select-none text-xs">
        <div
          onClick={() => {
            if (isDir) {
              toggleFolder(item.path);
            } else {
              loadFile(item.path);
            }
          }}
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          className={`group flex items-center justify-between py-1.5 pr-2.5 rounded-lg cursor-pointer transition-colors ${
            isSelected
              ? 'bg-blue-100/80 text-blue-900 font-semibold border-l-3 border-blue-600'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          <div className="flex items-center space-x-2 truncate">
            {isDir ? (
              <span className="text-slate-400 group-hover:text-slate-600 flex items-center">
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 mr-0.5 text-slate-500" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 mr-0.5 text-slate-500" />
                )}
                {isExpanded ? (
                  <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                ) : (
                  <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                )}
              </span>
            ) : isImagePath(item.path) ? (
              <ImageIcon className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : isMarkdownPath(item.path) ? (
              <FileText className="w-4 h-4 text-blue-500 shrink-0" />
            ) : (
              <FileCode className="w-4 h-4 text-slate-400 shrink-0" />
            )}

            <span className="truncate font-mono">{item.name}</span>

            {isRawDir && isDir && (
              <span className="inline-flex items-center space-x-0.5 px-1 py-0.2 rounded text-[10px] bg-amber-50 text-amber-700 border border-amber-200">
                <Lock className="w-2.5 h-2.5" />
                <span>聖域</span>
              </span>
            )}
          </div>

          <div className="flex items-center space-x-1.5 shrink-0 ml-2">
            {isLoading && <RefreshCw className="w-3 h-3 animate-spin text-blue-500" />}
            {item.size !== undefined && !isDir && (
              <span className="text-[10px] text-slate-400 font-mono">
                {formatFileSize(item.size)}
              </span>
            )}
          </div>
        </div>

        {/* 巢狀子目錄展開 */}
        {isDir && isExpanded && (
          <div className="space-y-0.5 mt-0.5">
            {folderChildren[item.path] ? (
              folderChildren[item.path].length > 0 ? (
                folderChildren[item.path].map((child) => renderTreeItem(child, depth + 1))
              ) : (
                <div
                  style={{ paddingLeft: `${(depth + 1) * 14 + 10}px` }}
                  className="py-1 text-[11px] text-slate-400 italic"
                >
                  (目錄為空)
                </div>
              )
            ) : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* 頂部操作與提示橫幅 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
            <GitCommit className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-sm text-slate-800">實驗 GitHub Workspace</h3>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono">
                {repositoryFullName}
              </span>
              {isCourseMode && (
                <span className="text-[11px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono border border-blue-200">
                  experiments/{experiment.experiment_code}/
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              同學共同維護的實驗儲存庫。每次儲存或上傳將產生真實 GitHub Git Commit。
            </p>
          </div>
        </div>

        {/* 操作工具列 */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRefreshWorkspace}
            disabled={treeLoading}
            className="inline-flex items-center space-x-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            title="重新取得真實 GitHub Workspace 檔案樹"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${treeLoading ? 'animate-spin text-blue-600' : ''}`} />
            <span>重新整理</span>
          </button>

          {isCollaborator && (
            <>
              <button
                onClick={() => {
                  setRawError(null);
                  setIsRawModalOpen(true);
                }}
                className="inline-flex items-center space-x-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg transition-colors shadow-xs cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>上傳原始資料</span>
              </button>

              <button
                onClick={() => {
                  setPhotoError(null);
                  setIsPhotoModalOpen(true);
                }}
                className="inline-flex items-center space-x-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors shadow-xs cursor-pointer"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>上傳照片</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* 最近一次操作回饋 (展示真實 Commit SHA) */}
      {lastOperation && (
        <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl flex items-center justify-between text-xs text-emerald-900 shadow-xs animate-fadeIn">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              操作成功（{lastOperation.action}）：
              <code className="bg-emerald-100/80 px-1 py-0.5 rounded font-mono ml-1 font-semibold">
                {lastOperation.path}
              </code>
            </span>
            <span className="text-emerald-600">|</span>
            <span className="flex items-center space-x-1">
              <span>Commit:</span>
              <code className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-emerald-300 text-emerald-800">
                {lastOperation.commit_sha.slice(0, 7)}
              </code>
            </span>
            <button
              onClick={() => handleCopySha(lastOperation.commit_sha)}
              className="text-emerald-700 hover:text-emerald-900 p-1 rounded hover:bg-emerald-100 transition-colors cursor-pointer"
              title="複製完整 40 位元 Commit SHA"
            >
              {copiedSha === lastOperation.commit_sha ? (
                <Check className="w-3 h-3 text-emerald-600" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>

          <div className="flex items-center space-x-2 text-[11px] text-emerald-700">
            <Clock className="w-3 h-3" />
            <span>{lastOperation.time}</span>
            {repositoryFullName && (
              <a
                href={`https://github.com/${repositoryFullName}/commit/${lastOperation.commit_sha}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center space-x-1 text-emerald-800 underline hover:text-emerald-950 font-medium ml-2"
              >
                <span>在 GitHub 查看 Commit</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* 主體區塊：左側檔案樹 + 右側檢視與編輯器 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 左側：檔案樹 */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs flex flex-col h-[650px]">
          <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-slate-100">
            <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-700">
              <Folder className="w-3.5 h-3.5 text-blue-600" />
              <span>儲存庫檔案樹</span>
            </div>
            <span className="text-[11px] text-slate-400">
              {rootItems.length} 個根目錄項目
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
            {treeLoading && rootItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-2 text-slate-400">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                <span className="text-xs">載入工作區檔案樹...</span>
              </div>
            ) : rootItems.length === 0 ? (
              <div className="text-center py-20 text-slate-400 text-xs">
                儲存庫尚無任何檔案，請使用上方功能上傳數據或照片。
              </div>
            ) : (
              rootItems.map((item) => renderTreeItem(item))
            )}
          </div>
        </div>

        {/* 右側：檔案內容 / 編輯器 */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col h-[650px]">
          {selectedPath ? (
            <>
              {/* 檔案頭部資訊與操作列 */}
              <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-200 gap-2">
                <div className="flex items-center space-x-2.5">
                  <div className="p-1.5 bg-slate-100 text-slate-700 rounded-md">
                    {isImagePath(selectedPath) ? (
                      <ImageIcon className="w-4 h-4 text-emerald-600" />
                    ) : isMarkdownPath(selectedPath) ? (
                      <FileText className="w-4 h-4 text-blue-600" />
                    ) : (
                      <FileCode className="w-4 h-4 text-slate-600" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h4 className="font-mono text-xs font-bold text-slate-900">{selectedPath}</h4>
                      {currentFile?.sha && (
                        <span
                          onClick={() => handleCopySha(currentFile.sha)}
                          className="text-[10px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                          title="點擊複製檔案 SHA"
                        >
                          SHA: {currentFile.sha.slice(0, 7)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 text-[11px] text-slate-400 mt-0.5">
                      {currentFile?.size !== undefined && (
                        <span>大小: {formatFileSize(currentFile.size)}</span>
                      )}
                      {repositoryFullName && (
                        <a
                          href={`https://github.com/${repositoryFullName}/blob/main/${getScopedPath(selectedPath)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center space-x-0.5 text-blue-600 hover:underline"
                        >
                          <span>在 GitHub 開啟</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* 模式切換與儲存按鈕 */}
                <div className="flex items-center space-x-2">
                  {!isImagePath(selectedPath) && (
                    <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-medium">
                      <button
                        onClick={() => setEditorMode('view')}
                        className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                          editorMode === 'view'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <span className="flex items-center space-x-1">
                          <Eye className="w-3 h-3" />
                          <span>檢視</span>
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          if (!editPermission.allowed) {
                            onError(editPermission.reason);
                            return;
                          }
                          setEditorMode('edit');
                        }}
                        disabled={!editPermission.allowed}
                        className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                          editorMode === 'edit'
                            ? 'bg-white text-blue-600 shadow-xs font-semibold'
                            : editPermission.allowed
                            ? 'text-slate-600 hover:text-slate-900'
                            : 'text-slate-300 cursor-not-allowed'
                        }`}
                        title={!editPermission.allowed ? editPermission.reason : '切換為編輯模式'}
                      >
                        <span className="flex items-center space-x-1">
                          <Edit3 className="w-3 h-3" />
                          <span>編輯</span>
                        </span>
                      </button>
                    </div>
                  )}

                  {editorMode === 'edit' && editPermission.allowed && (
                    <button
                      onClick={handleSaveFile}
                      disabled={saving}
                      className="inline-flex items-center space-x-1 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{saving ? '提交至 GitHub...' : '儲存並產生 Commit'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* 409 Conflict 衝突警示橫幅 */}
              {conflictOccurred && (
                <div className="bg-amber-50 border-2 border-amber-300 p-3.5 rounded-xl mb-3 flex items-center justify-between text-xs text-amber-900 animate-fadeIn">
                  <div className="flex items-center space-x-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                    <div>
                      <p className="font-bold">樂觀鎖衝突 (409 Conflict)</p>
                      <p className="mt-0.5">
                        這個檔案已經被其他同學修改，請重新載入最新版本後再編輯。
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleReloadConflictFile}
                    className="inline-flex items-center space-x-1.5 font-semibold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg transition-colors shrink-0 cursor-pointer shadow-xs"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>重新載入最新版本</span>
                  </button>
                </div>
              )}

              {/* 權限不符提示橫幅 (例如 Separate Report 他人報告或 Raw 聖域) */}
              {!editPermission.allowed && (
                <div className="bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg mb-3 flex items-center space-x-2 text-xs text-slate-600">
                  <ShieldAlert className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>{editPermission.reason}</span>
                </div>
              )}

              {/* 內容區域 */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {fileLoading ? (
                  <div className="flex flex-col items-center justify-center h-full space-y-2 text-slate-400">
                    <RefreshCw className="w-7 h-7 animate-spin text-blue-500" />
                    <span className="text-xs">正在從 GitHub 讀取檔案內容...</span>
                  </div>
                ) : isImagePath(selectedPath) ? (
                  /* 圖片展示區 */
                  <div className="flex flex-col items-center justify-center p-6 space-y-4 bg-slate-50 rounded-xl border border-slate-200 h-full">
                    <div className="max-w-md max-h-96 overflow-hidden rounded-lg shadow-sm border border-slate-200 bg-white p-2">
                      <img
                        src={
                          currentFile?.content_base64
                            ? `data:${imageMimeType(selectedPath)};base64,${currentFile.content_base64}`
                            : `https://raw.githubusercontent.com/${repositoryFullName}/main/${getScopedPath(selectedPath)}`
                        }
                        alt={selectedPath}
                        className="max-h-80 w-auto object-contain mx-auto rounded"
                        onError={(e) => {
                          // 私有庫或直連失敗時的安全後備
                          (e.currentTarget as HTMLElement).style.display = 'none';
                          const fallbackDiv = document.getElementById(`img-fallback-${selectedPath}`);
                          if (fallbackDiv) fallbackDiv.style.display = 'flex';
                        }}
                      />
                      <div
                        id={`img-fallback-${selectedPath}`}
                        style={{ display: 'none' }}
                        className="flex flex-col items-center justify-center py-12 px-4 text-center space-y-2"
                      >
                        <ImageIcon className="w-10 h-10 text-slate-400" />
                        <p className="text-xs font-semibold text-slate-700">圖片二進位檔案</p>
                        <p className="text-[11px] text-slate-400 max-w-xs">
                          私有儲存庫可點擊下方按鈕直接在 GitHub 檢視高解析原圖。
                        </p>
                      </div>
                    </div>

                    {repositoryFullName && (
                      <a
                        href={`https://github.com/${repositoryFullName}/blob/main/${getScopedPath(selectedPath)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center space-x-1.5 text-xs font-semibold bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg transition-colors shadow-xs"
                      >
                        <span>在 GitHub 檢視原始圖片</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ) : editorMode === 'edit' && editPermission.allowed ? (
                  /* 文字檔編輯器 */
                  <div className="flex flex-col h-full space-y-2.5">
                    <div className="flex items-center space-x-2">
                      <label className="text-xs font-medium text-slate-600 shrink-0">Commit 說明:</label>
                      <input
                        type="text"
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        placeholder="例：更新實驗數據、修訂實驗報告"
                        className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-sans"
                      />
                    </div>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="flex-1 w-full p-3 font-mono text-xs text-slate-800 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 resize-none leading-relaxed"
                      placeholder="請輸入文字或程式碼..."
                    />
                  </div>
                ) : (
                  /* 檔案檢視模式 (Markdown 或 純文字) */
                  <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200 h-full overflow-y-auto">
                    {isMarkdownPath(selectedPath) ? (
                      <SimpleMarkdownViewer content={currentFile?.content || ''} />
                    ) : (
                      <pre className="text-xs font-mono text-slate-800 whitespace-pre-wrap break-all leading-relaxed">
                        <code>{currentFile?.content || ''}</code>
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-3">
              <div className="p-4 bg-slate-50 rounded-full text-slate-400">
                <FileText className="w-8 h-8" />
              </div>
              <p className="text-sm font-medium text-slate-600">請從左側檔案樹點選檔案</p>
              <p className="text-xs text-slate-400 text-center max-w-xs">
                點選文字檔可進行閱讀與修改；點選照片可預覽圖檔。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 模態視窗 1：上傳原始數據 (Raw Data Sanctuary) */}
      {isRawModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
                  <Lock className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-base text-slate-900">上傳原始資料至 raw/</h3>
              </div>
              <button
                onClick={() => setIsRawModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUploadRawSubmit} className="space-y-4 mt-4">
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-xs text-amber-900 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Raw Data 聖域保護原則</p>
                  <p className="mt-0.5">
                    原始量測數據將自動存放於 <code>raw/</code>。一旦上傳完成，嚴禁任何覆寫或刪除。
                  </p>
                </div>
              </div>

              {rawError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{rawError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  選擇原始實驗數據檔案 <span className="text-red-500">*</span>
                </label>
                <input
                  type="file"
                  accept=".csv,.txt,.json,.dat,.xlsx,.tsv"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setRawFile(f);
                    if (f && !rawMessage) {
                      setRawMessage(`upload raw data: ${f.name}`);
                    }
                  }}
                  className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer border border-slate-200 rounded-lg p-1.5"
                />
                <p className="text-[11px] text-slate-400 mt-1">支援 CSV, TXT, JSON, DAT 等原始量測檔案</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Commit 說明 (可選)
                </label>
                <input
                  type="text"
                  value={rawMessage}
                  onChange={(e) => setRawMessage(e.target.value)}
                  placeholder="例：上傳示波器取樣原始數據"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsRawModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={uploadingRaw || !rawFile}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {uploadingRaw ? '正在上傳至 GitHub...' : '確認上傳'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 模態視窗 2：上傳實驗照片 */}
      {isPhotoModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                  <ImageIcon className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-base text-slate-900">上傳照片至 photos/</h3>
              </div>
              <button
                onClick={() => setIsPhotoModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUploadPhotoSubmit} className="space-y-4 mt-4">
              <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl text-xs text-blue-900">
                照片將自動存入 <code>photos/</code> 目錄。單檔限制上限為 5MB。
              </div>

              {photoError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{photoError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  選擇照片檔案 <span className="text-red-500">*</span>
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setPhotoFile(f);
                    if (f) {
                      if (f.size > 5 * 1024 * 1024) {
                        setPhotoError('照片不能超過 5MB。');
                      } else {
                        setPhotoError(null);
                      }
                      setPhotoPreviewUrl(URL.createObjectURL(f));
                      if (!photoMessage) {
                        setPhotoMessage(`upload photo: ${f.name}`);
                      }
                    } else {
                      setPhotoPreviewUrl(null);
                    }
                  }}
                  className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer border border-slate-200 rounded-lg p-1.5"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  支援 JPG, PNG, WEBP（單檔不可超過 5MB）
                </p>
              </div>

              {photoPreviewUrl && (
                <div className="p-2 border border-slate-200 rounded-lg bg-slate-50 text-center">
                  <img
                    src={photoPreviewUrl}
                    alt="Preview"
                    className="max-h-36 mx-auto rounded object-contain"
                  />
                  {photoFile && (
                    <span className="text-[11px] text-slate-400 mt-1 block">
                      {photoFile.name} ({formatFileSize(photoFile.size)})
                    </span>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Commit 說明 (可選)
                </label>
                <input
                  type="text"
                  value={photoMessage}
                  onChange={(e) => setPhotoMessage(e.target.value)}
                  placeholder="例：上傳電路接線圖照片"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsPhotoModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={uploadingPhoto || !photoFile || Boolean(photoError)}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {uploadingPhoto ? '正在上傳至 GitHub...' : '確認上傳'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
