import React, { useState, useEffect } from 'react';
import { ExperimentConfig, ActivityLogItem, CommitItem, FileItem } from '../types/index.ts';
import {
  ArrowLeft,
  Upload,
  Download,
  FolderTree,
  FileText,
  Activity,
  GitCommit,
  Bot,
  ExternalLink,
  CheckCircle,
  Copy,
  Printer,
  ShieldCheck,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import JSZip from 'jszip';

interface LabDetailProps {
  lab: ExperimentConfig;
  onBack: () => void;
}

type TabType = 'files' | 'upload' | 'download' | 'report' | 'activity' | 'git' | 'agent';

export const LabDetail: React.FC<LabDetailProps> = ({ lab, onBack }) => {
  const [activeTab, setActiveTab] = useState<TabType>('report');
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);

  // 模擬/讀取之檔案樹
  const mockFiles: FileItem[] = [
    { name: 'config.yml', path: 'config.yml', type: 'file', category: 'root' },
    { name: 'README.md', path: 'README.md', type: 'file', category: 'root' },
    { name: 'measurements.csv', path: 'raw/measurements.csv', type: 'file', size: 1024, category: 'raw' },
    { name: 'circuit_setup.jpg', path: 'photos/circuit_setup.jpg', type: 'file', size: 2048576, category: 'photos' },
    { name: 'measurements_clean.csv', path: 'processed/measurements_clean.csv', type: 'file', size: 890, category: 'processed' },
    { name: 'plot_curve.py', path: 'analysis/plot_curve.py', type: 'file', size: 450, category: 'analysis' },
    { name: 'bjt_curve.svg', path: 'analysis/bjt_curve.svg', type: 'file', size: 12400, category: 'analysis' },
    { name: 'report.md', path: 'report/report.md', type: 'file', size: 3400, category: 'report' },
    { name: 'SKILL.md', path: '.github/skills/experiment-report/SKILL.md', type: 'file', category: 'root' },
  ];

  // 活動紀錄狀態 (Activity Log v1.2 API 整合)
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);
  const [activityLoading, setActivityLoading] = useState<boolean>(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [isMockMode, setIsMockMode] = useState<boolean>(false);

  // 安全解析 files_changed (JSON array 字串或逗號分隔，容錯防崩潰)
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

  // 讀取活動紀錄 API (GET /api/activity?repo=...&exp=...)
  const fetchActivityLogs = async () => {
    const repo = lab.repository || `example-org/${lab.course_id.toLowerCase()}-${lab.experiment_id}`;
    const exp = lab.experiment_id;
    setActivityLoading(true);
    setActivityError(null);

    try {
      const res = await fetch(`/api/activity?repo=${encodeURIComponent(repo)}&exp=${encodeURIComponent(exp)}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      setIsMockMode(data.mode === 'mock');
      setActivityLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (err: any) {
      setActivityError(err.message || '讀取活動紀錄時發生錯誤');
      setActivityLogs([]);
      setIsMockMode(false);
    } finally {
      setActivityLoading(false);
    }
  };

  // 當切換至 activity 分頁或更換實驗時自動取得真實資料
  useEffect(() => {
    if (activeTab === 'activity') {
      fetchActivityLogs();
    }
  }, [activeTab, lab.repository, lab.experiment_id]);

  // 模擬 Git Commits (白話繁體中文)
  const commits: CommitItem[] = [
    {
      sha: 'a83f91c',
      message: `[${lab.experiment_id}] 新增 BJT 特性曲線並更新實驗討論`,
      author: 'studentA',
      date: '10 分鐘前',
    },
    {
      sha: '4f2e90b',
      message: `[${lab.experiment_id}] 整理量測資料並計算放大倍率平均值`,
      author: 'studentA',
      date: '1 小時前',
    },
    {
      sha: 'c1028ba',
      message: `[${lab.experiment_id}] 新增今天的示波器量測照片與原始數據`,
      author: 'studentA',
      date: '2 小時前',
    },
    {
      sha: '0e78a2d',
      message: `[${lab.experiment_id}] 初始化實驗工作區 (Template v1.0)`,
      author: 'studentA',
      date: '3 天前',
    },
  ];

  // 觸發 MathJax 渲染
  useEffect(() => {
    if (window && (window as any).MathJax && (window as any).MathJax.typesetPromise) {
      (window as any).MathJax.typesetPromise();
    }
  }, [activeTab]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPrompt(id);
    setTimeout(() => setCopiedPrompt(null), 2000);
  };

  // 打包下載功能 (純前端免後端負擔)
  const handleDownloadZip = async (type: 'all' | 'photos' | 'raw') => {
    const zip = new JSZip();
    const prefix = `${lab.experiment_id}-${lab.experiment_name}`;

    if (type === 'all' || type === 'raw') {
      const rawFolder = zip.folder('raw');
      rawFolder?.file('measurements.csv', 'Vce(V),Ib(uA),Ic(mA)\n0.0,10,0.00\n1.0,10,1.02\n2.0,10,1.05\n');
    }
    if (type === 'all' || type === 'photos') {
      const photoFolder = zip.folder('photos');
      photoFolder?.file('readme.txt', '實驗量測照片存放區 (本示範包已模擬壓縮)\n');
    }
    if (type === 'all') {
      zip.file('config.yml', `experiment_id: "${lab.experiment_id}"\nstatus: "${lab.status}"\n`);
      zip.file('README.md', `# ${lab.experiment_name}\n`);
      const reportFolder = zip.folder('report');
      reportFolder?.file('report.md', `# 實驗報告：${lab.experiment_name}\n`);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${prefix}-${type}.zip`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* 頂部資訊列 */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center space-x-2.5">
                <span className="text-xs font-mono font-bold bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded">
                  {lab.experiment_id.toUpperCase()}
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  {lab.course_name} ({lab.course_id})
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                  {lab.report_mode === 'shared' ? '共同報告模式' : '獨立報告模式'}
                </span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mt-1">{lab.experiment_name}</h2>
              <div className="flex items-center space-x-4 mt-2 text-xs text-slate-500">
                <span>組員：{lab.members.map((m) => `${m.name} (@${m.github})`).join('、')}</span>
                <span>•</span>
                <span>Template v{lab.template_version}</span>
                <span>•</span>
                <span>Skill v{lab.skill_version}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <a
              href={`https://github.com/${lab.repository || 'example-org/electronics-lab-01'}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-1.5 text-xs font-medium text-slate-700 hover:text-blue-600 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>開啟 GitHub Repo</span>
            </a>
          </div>
        </div>

        {/* 分頁導覽列 */}
        <div className="flex border-b border-slate-200 mt-6 -mb-6 space-x-1 overflow-x-auto">
          {[
            { id: 'report', label: '📄 查看報告', icon: FileText },
            { id: 'files', label: '📂 瀏覽檔案', icon: FolderTree },
            { id: 'upload', label: '📤 上傳資料', icon: Upload },
            { id: 'download', label: '📥 下載資料', icon: Download },
            { id: 'activity', label: '📋 活動紀錄', icon: Activity },
            { id: 'git', label: '🔀 Git History', icon: GitCommit },
            { id: 'agent', label: '🤖 使用 Agent', icon: Bot },
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
        {/* 1. 查看報告 */}
        {activeTab === 'report' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center space-x-2 text-sm text-slate-600">
                <FileText className="w-4 h-4 text-blue-600" />
                <span>來源路徑：<code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">report/report.md</code></span>
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
                實驗報告：{lab.experiment_name}
              </h1>
              
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm space-y-1">
                <div><strong>課程名稱</strong>：{lab.course_name} ({lab.course_id})</div>
                <div><strong>組員名單</strong>：{lab.members.map(m => `${m.name} (${m.github})`).join('、')}</div>
                <div><strong>報告模式</strong>：{lab.report_mode === 'shared' ? '共同撰寫 (shared)' : '個別撰寫 (separate)'}</div>
              </div>

              <h3 className="text-lg font-bold text-slate-900 pt-2">一、實驗目的</h3>
              <p className="text-sm leading-relaxed">
                1. 瞭解雙極性接面電晶體之端點偏壓與工作特性。<br />
                2. 量測並繪製輸出特性曲線族（{"\\(I_C\\) vs \\(V_{CE}\\)"} 在不同 {"\\(I_B\\)"} 偏壓條件下）。<br />
                3. 計算電晶體共射極直流電流增益 {"\\(\\beta\\)"}，並觀察 Early 效應。
              </p>

              <h3 className="text-lg font-bold text-slate-900 pt-2">二、實驗原理</h3>
              <p className="text-sm leading-relaxed">
                在主動放大區中，集極電流由基極電流控制，線性關係如下：
              </p>
              <div className="bg-blue-50/50 p-3 rounded border border-blue-100 text-center font-mono text-base">
                $$I_C = \beta \cdot I_B$$
              </div>

              <h3 className="text-lg font-bold text-slate-900 pt-2">三、特性曲線分析</h3>
              <p className="text-sm text-slate-600 mb-2">
                由 <code>analysis/plot_curve.py</code> 產出之向量特性曲線圖：
              </p>
              <div className="border border-slate-200 rounded-lg p-4 bg-white flex justify-center">
                <svg viewBox="0 0 500 240" className="w-full max-w-lg h-auto">
                  <rect width="500" height="240" fill="#fafafa" rx="6"/>
                  <text x="250" y="24" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#334155">2N3904 特性曲線 (Ic vs Vce)</text>
                  <line x1="60" y1="200" x2="460" y2="200" stroke="#94a3b8" strokeWidth="2"/>
                  <line x1="60" y1="200" x2="60" y2="40" stroke="#94a3b8" strokeWidth="2"/>
                  <path d="M 60 200 Q 90 90 120 85 L 450 75" fill="none" stroke="#2563eb" strokeWidth="2.5"/>
                  <path d="M 60 200 Q 90 135 120 130 L 450 122" fill="none" stroke="#16a34a" strokeWidth="2.5"/>
                  <path d="M 60 200 Q 90 175 120 172 L 450 168" fill="none" stroke="#ea580c" strokeWidth="2.5"/>
                  <text x="455" y="75" fontSize="10" fill="#2563eb">Ib=30uA</text>
                  <text x="455" y="122" fontSize="10" fill="#16a34a">Ib=20uA</text>
                  <text x="455" y="168" fontSize="10" fill="#ea580c">Ib=10uA</text>
                  <text x="250" y="225" textAnchor="middle" fontSize="11" fill="#64748b">Vce (V)</text>
                </svg>
              </div>
            </article>
          </div>
        )}

        {/* 2. 瀏覽檔案 */}
        {activeTab === 'files' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              檔案結構完全鏡射自 GitHub 遠端 Repository：
            </p>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 font-mono text-xs">
              {mockFiles.map((file) => (
                <div key={file.path} className="p-3 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center space-x-3">
                    <span className="text-slate-400">
                      {file.category === 'raw' && '📁'}
                      {file.category === 'photos' && '📸'}
                      {file.category === 'processed' && '🧹'}
                      {file.category === 'analysis' && '📊'}
                      {file.category === 'report' && '📝'}
                      {file.category === 'root' && '📄'}
                    </span>
                    <span className="font-semibold text-slate-800">{file.path}</span>
                    {file.category === 'raw' && (
                      <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-[10px]">
                        原始數據 (唯讀)
                      </span>
                    )}
                  </div>
                  <span className="text-slate-400">
                    {file.size ? `${(file.size / 1024).toFixed(1)} KB` : '目錄/系統'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. 快速上傳 */}
        {activeTab === 'upload' && (
          <div className="space-y-6">
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-bold">原始資料保護提示</p>
                <p className="mt-0.5">
                  上傳至 <code>raw/</code> 之檔案一旦提交將受 Agent Skill 聖域保護，嚴禁覆蓋或刪除。若需清洗與運算請交由 Agent 輸出至 <code>processed/</code>。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 上傳照片 */}
              <div className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-8 text-center transition-colors">
                <div className="mx-auto w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <h4 className="font-semibold text-slate-800 text-sm">上傳實驗照片至 photos/</h4>
                <p className="text-xs text-slate-400 mt-1 mb-4">支援 JPG、PNG、HEIC（麵包板接線、示波器畫面）</p>
                <label className="inline-block bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer transition-colors">
                  選擇照片檔案
                  <input type="file" multiple accept="image/*" className="hidden" />
                </label>
              </div>

              {/* 上傳量測數據 */}
              <div className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-8 text-center transition-colors">
                <div className="mx-auto w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <h4 className="font-semibold text-slate-800 text-sm">上傳原始量測數據至 raw/</h4>
                <p className="text-xs text-slate-400 mt-1 mb-4">支援 CSV、XLSX、TXT、DAT（儀器導出資料）</p>
                <label className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer transition-colors">
                  選擇數據檔案
                  <input type="file" multiple accept=".csv,.xlsx,.txt,.dat" className="hidden" />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* 4. 打包下載 */}
        {activeTab === 'download' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              提供免經 R2 中轉的一鍵打包串流下載：
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="border border-slate-200 rounded-xl p-4 flex flex-col justify-between hover:border-blue-400 transition-colors">
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">📸 下載全部照片</h4>
                  <p className="text-xs text-slate-400 mt-1">打包 photos/ 目錄中的所有實驗影像檔</p>
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
                  <h4 className="font-semibold text-sm text-slate-800">📁 下載原始數據</h4>
                  <p className="text-xs text-slate-400 mt-1">打包 raw/ 目錄中的所有量測原始數據</p>
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

        {/* 5. 活動紀錄 (符合 Section VII 與 D1 規範) */}
        {activeTab === 'activity' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-500 font-medium">
                    紀錄層級：誰在何時以何種方式做了什麼
                  </span>
                  {isMockMode ? (
                    <span className="text-[10px] font-mono bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-semibold border border-amber-200">
                      示範模式 (無 D1)
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-semibold border border-blue-100">
                      Cloudflare D1 持久化存檔
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  唯讀操作稽核紀錄 • Git Repository 為唯一變更真實資料源 (Source of Truth)
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={fetchActivityLogs}
                  disabled={activityLoading}
                  className="inline-flex items-center space-x-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  title="重新從 API 載入最新活動紀錄"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${activityLoading ? 'animate-spin' : ''}`} />
                  <span>重新整理</span>
                </button>
              </div>
            </div>

            {/* 示範資料提示橫幅 */}
            {isMockMode && !activityLoading && (
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl flex items-center justify-between text-xs text-amber-800">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    <strong>示範資料提示</strong>：目前為示範資料，尚未連接 D1。
                  </span>
                </div>
                <span className="font-mono text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded">
                  mode: mock
                </span>
              </div>
            )}

            {/* 載入中狀態 */}
            {activityLoading && (
              <div className="flex flex-col items-center justify-center py-16 space-y-3 text-slate-400">
                <RefreshCw className="w-7 h-7 animate-spin text-blue-500" />
                <span className="text-sm">正在載入活動紀錄...</span>
              </div>
            )}

            {/* 錯誤狀態 */}
            {!activityLoading && activityError && (
              <div className="border border-red-200 bg-red-50 p-6 rounded-xl text-center space-y-3">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
                <div>
                  <h4 className="text-sm font-bold text-red-800">無法讀取活動紀錄</h4>
                  <p className="text-xs text-red-600 mt-1 font-mono">{activityError}</p>
                </div>
                <button
                  onClick={fetchActivityLogs}
                  className="inline-flex items-center space-x-1.5 text-xs bg-white border border-red-300 text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>重試</span>
                </button>
              </div>
            )}

            {/* 空資料狀態 */}
            {!activityLoading && !activityError && activityLogs.length === 0 && (
              <div className="border border-dashed border-slate-200 rounded-xl py-16 text-center space-y-2 text-slate-400">
                <Activity className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-sm font-medium text-slate-600">目前尚無活動紀錄</p>
                <p className="text-xs text-slate-400">
                  在本地工作區透過 Agent 執行操作或手動提交後，活動稽核事件將會即時記錄在此。
                </p>
              </div>
            )}

            {/* 時間軸清單 */}
            {!activityLoading && !activityError && activityLogs.length > 0 && (
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
                      // ignore parse error
                    }
                  }

                  return (
                    <div key={log.id} className="relative pl-6">
                      {/* 節點圓點 */}
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

                          {/* 動作與授權標籤 */}
                          {isRejected && (
                            <span className="text-[10px] bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.2 rounded font-semibold">
                              🚨 安全攔截 (越權拒絕)
                            </span>
                          )}
                          {isPending && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.2 rounded font-semibold">
                              ⏳ 等待授權
                            </span>
                          )}
                          {log.approval_status === 'approved' && !isRejected && (
                            <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 rounded font-semibold">
                              ✓ 已授權
                            </span>
                          )}

                          <span className="text-xs text-slate-400 font-mono">{log.timestamp}</span>
                        </div>

                        {/* 摘要 */}
                        <p className="text-sm text-slate-700">{log.summary}</p>

                        {/* 拒絕細節 */}
                        {isRejected && detailsObj?.rejection_reason && (
                          <div className="text-xs text-red-600 bg-red-50 px-2.5 py-1 rounded border border-red-200 font-mono">
                            攔截原因：{detailsObj.rejection_reason}
                          </div>
                        )}

                        {/* 中繼資料行 (目標、異動、發起人、核准人、Commit 連結) */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 font-mono pt-0.5">
                          {/* 目標檔案 */}
                          {log.target && (
                            <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[11px]">
                              🎯 目標: {log.target}
                            </span>
                          )}

                          {/* 發起人與核准人 */}
                          {log.requested_by && <span>發起人: @{log.requested_by}</span>}
                          {log.approved_by && <span>核准人: @{log.approved_by}</span>}

                          {/* Commit 連結 */}
                          {log.commit_sha && (
                            <a
                              href={`https://github.com/${log.repo_name || lab.repository}/commit/${log.commit_sha}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1 text-blue-600 hover:text-blue-800 hover:underline font-semibold"
                            >
                              <span>Commit: {log.commit_sha.slice(0, 7)}</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>

                        {/* 異動檔案列表 */}
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

        {/* 6. Git History (白話繁體中文) */}
        {activeTab === 'git' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              所有 Commit 均依據 Agent Skill 嚴格採用白話繁體中文提交：
            </p>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {commits.map((c) => (
                <div key={c.sha} className="p-4 flex items-center justify-between hover:bg-slate-50">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-slate-900">{c.message}</div>
                    <div className="flex items-center space-x-2 text-xs text-slate-400">
                      <span>提交者：{c.author}</span>
                      <span>•</span>
                      <span>{c.date}</span>
                    </div>
                  </div>
                  <code className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded font-mono">
                    {c.sha}
                  </code>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 7. 使用 Agent 指南 */}
        {activeTab === 'agent' && (
          <div className="space-y-6">
            <div className="bg-purple-50 border border-purple-200 p-4 rounded-xl flex items-start space-x-3">
              <ShieldCheck className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
              <div className="text-sm text-purple-900">
                <p className="font-bold">Agent-First 工作模式與安全確認鎖</p>
                <p className="mt-0.5">
                  在本地開啟 AI Agent（Antigravity、Cursor、Claude Code 或 VS Code）時，Agent 會自動載入 <code>.github/skills/experiment-report/SKILL.md</code>。在執行修改或 Commit 前，Agent 會列出清單徵求確認，未獲回覆前絕不推送。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                {
                  id: 'p1',
                  title: '📸 照片分類與整理',
                  prompt: '請根據 .github/skills/experiment-report/SKILL.md 規範，幫我檢查 photos/ 目錄中的量測照片，按照實驗步驟分類並標註說明。',
                },
                {
                  id: 'p2',
                  title: '🧹 原始數據清洗 (保護 raw/)',
                  prompt: '請讀取 raw/measurements.csv，進行數據清洗、單位標準化並計算平均值，輸出至 processed/measurements_clean.csv。注意切勿修改 raw/ 原檔！',
                },
                {
                  id: 'p3',
                  title: '📊 繪製特性曲線圖',
                  prompt: '請根據 processed/ 乾淨數據，撰寫 Python 腳本繪製特性曲線圖，標註好坐標軸物理量名稱與單位，輸出高解析度 SVG 圖檔至 analysis/。',
                },
                {
                  id: 'p4',
                  title: '📝 起草與完善實驗報告',
                  prompt: '請根據 analysis/ 的曲線圖與 processed/ 的數據，在 report/report.md 中補充「實驗數據分析」與「問題與討論」章節，包含理論誤差百分比計算。',
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
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
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
    </div>
  );
};
