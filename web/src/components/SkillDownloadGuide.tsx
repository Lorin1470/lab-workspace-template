import React, { useState } from 'react';
import {
  Download,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  Info,
  FileCode,
  FolderArchive,
  Bot,
  ExternalLink,
  Github,
} from 'lucide-react';

import {
  AGENT_INSTALL_PROMPT,
  SKILL_REPO_URL,
  SKILL_RAW_URL,
  downloadRawSkill,
  downloadSkillZip,
  copyInstallPrompt,
} from '../utils/skill-downloader.ts';

interface SkillDownloadGuideProps {
  onError?: (msg: string) => void;
  onSuccess?: (msg: string) => void;
  className?: string;
}

export const SkillDownloadGuide: React.FC<SkillDownloadGuideProps> = ({
  onError,
  onSuccess,
  className = '',
}) => {
  const [downloadingRaw, setDownloadingRaw] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // 下載原始 SKILL.md
  const handleDownloadRaw = async () => {
    setDownloadingRaw(true);
    try {
      const res = await downloadRawSkill();
      onSuccess?.(`已成功下載原始 Skill 規格書 (${res.filename})`);
    } catch (err: any) {
      const msg = err?.message || '下載原始 SKILL.md 失敗';
      onError?.(msg);
    } finally {
      setDownloadingRaw(false);
    }
  };

  // 下載 Skill ZIP 壓縮包
  const handleDownloadZip = async () => {
    setDownloadingZip(true);
    try {
      const res = await downloadSkillZip();
      onSuccess?.(
        `已成功建立並下載 Skill ZIP 壓縮包 (${res.filename}，內含 ${res.files.length} 個檔案)`
      );
    } catch (err: any) {
      const msg = err?.message || '打包下載 Skill ZIP 失敗';
      onError?.(msg);
    } finally {
      setDownloadingZip(false);
    }
  };

  // 複製安裝提示詞
  const handleCopyPrompt = async () => {
    const result = await copyInstallPrompt(AGENT_INSTALL_PROMPT);
    if (result.success) {
      setCopied(true);
      setCopyFeedback({
        type: 'success',
        message: '已成功複製 Agent 安裝提示詞至剪貼簿！可直接貼給 AI Agent。',
      });
      onSuccess?.('已成功複製 Agent 安裝提示詞至剪貼簿');
      setTimeout(() => {
        setCopied(false);
        setCopyFeedback(null);
      }, 4000);
    } else {
      setCopyFeedback({
        type: 'error',
        message: result.error || '剪貼簿寫入失敗，請手動反白選取下方文字進行複製。',
      });
      onError?.('複製提示詞失敗：請手動選取內容進行複製');
    }
  };

  return (
    <section
      aria-label="Agent Skill 下載與安裝引導"
      className={`bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm space-y-6 transition-colors ${className}`}
    >
      {/* 標題與簡介 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-700/60">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 px-2.5 py-0.5 rounded flex items-center space-x-1">
              <Bot className="w-3.5 h-3.5 mr-1" />
              <span>AI Agent Skill</span>
            </span>
            <span className="text-xs font-mono text-slate-600 dark:text-slate-300 font-semibold bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600">
              github-workspace
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-medium">
              v1.0 官方標準規範
            </span>
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mt-2">
            github-workspace Skill 下載與 Agent 安裝引導
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            供 Antigravity、OpenAI Codex、Claude Code、Cursor 等各大支援 Agent Skill 的 AI 助理使用。直連 GitHub 安全操作工作區與報告。
          </p>
        </div>
      </div>

      {/* 官方來源資訊 */}
      <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-xs space-y-2">
        <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center space-x-1.5">
          <Github className="w-4 h-4 text-slate-700 dark:text-slate-300" />
          <span>官方來源</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-600 dark:text-slate-300">
          <div className="flex items-center space-x-1.5 truncate">
            <span className="text-slate-400 dark:text-slate-500 shrink-0">GitHub 儲存庫：</span>
            <a
              href={SKILL_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline truncate inline-flex items-center space-x-1 font-mono"
            >
              <span className="truncate">{SKILL_REPO_URL}</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          </div>
          <div className="flex items-center space-x-1.5 truncate">
            <span className="text-slate-400 dark:text-slate-500 shrink-0">原始 Skill：</span>
            <a
              href={SKILL_RAW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline truncate inline-flex items-center space-x-1 font-mono"
            >
              <span className="truncate">GitHub Raw SKILL.md</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          </div>
        </div>
      </div>

      {/* 關鍵宣告：下載與安裝是兩個不同步驟，且本站無權限也不會直接安裝至本機 */}
      <div className="bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-start space-x-3 text-xs text-amber-900 dark:text-amber-300">
        <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-bold text-amber-950 dark:text-amber-200">
            安裝說明：網站僅提供檔案下載與安裝提示詞
          </div>
          <p className="text-amber-800 dark:text-amber-300/90 leading-relaxed">
            本網站<strong>不會亦無法直接安裝</strong>任何擴充套件至您的個人電腦中。安裝過程嚴格分為<strong>「步驟一：下載 Skill 檔案」</strong>與<strong>「步驟二：交由 Agent 讀取並安裝」</strong>兩個獨立步驟，請依序完成引導。
          </p>
        </div>
      </div>

      {/* 步驟導引雙欄 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 步驟 1：下載 Skill */}
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-5 flex flex-col justify-between bg-slate-50/60 dark:bg-slate-900/40 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                1
              </span>
              <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                步驟一：下載 Skill 檔案
              </h4>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              請先將 Skill 檔案儲存至您的本機電腦。提供原始單檔或已包含完整目錄結構的 ZIP 壓縮包：
            </p>

            <div className="space-y-2.5 pt-1">
              {/* 下載原始 SKILL.md */}
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex items-center justify-between hover:border-blue-300 dark:hover:border-blue-500 transition-colors">
                <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                  <div className="p-2 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-lg shrink-0">
                    <FileCode className="w-4 h-4" />
                  </div>
                  <div className="truncate">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">原始 SKILL.md</div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">官方正式規範原始 Markdown 文件</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadRaw}
                  disabled={downloadingRaw}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-blue-900/50 hover:text-blue-700 dark:hover:text-blue-300 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg transition-colors flex items-center space-x-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                  title="下載原始 SKILL.md 檔案"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{downloadingRaw ? '下載中...' : '下載 SKILL.md'}</span>
                </button>
              </div>

              {/* 下載 ZIP 壓縮包 */}
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex items-center justify-between hover:border-purple-300 dark:hover:border-purple-500 transition-colors">
                <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                  <div className="p-2 bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 rounded-lg shrink-0">
                    <FolderArchive className="w-4 h-4" />
                  </div>
                  <div className="truncate">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">Skill 目錄壓縮包 (ZIP)</div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">內含標準 github-workspace/ 目錄結構</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  disabled={downloadingZip}
                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center space-x-1.5 cursor-pointer disabled:opacity-50 shrink-0 shadow-xs"
                  title="下載包含 github-workspace/ 目錄結構的 ZIP 壓縮包"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{downloadingZip ? '打包中...' : '下載 ZIP'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
            📦 ZIP 打包結構：<code>github-workspace/SKILL.md</code>
          </div>
        </div>

        {/* 步驟 2：複製 Agent 安裝提示詞 */}
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-5 flex flex-col justify-between bg-slate-50/60 dark:bg-slate-900/40 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  2
                </span>
                <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                  步驟二：一鍵複製安裝提示詞
                </h4>
              </div>

              <button
                type="button"
                onClick={handleCopyPrompt}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center space-x-1.5 cursor-pointer shrink-0 ${
                  copied
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white'
                }`}
                title="複製 Agent 安裝提示詞至剪貼簿"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>已複製提示詞</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>複製 Agent 安裝提示詞</span>
                  </>
                )}
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              下載檔案後，複製下方精簡安裝提示詞直接傳送給您的 AI Agent。提示詞已內含 GitHub 官方來源、規範路徑選擇、防覆寫比對與安裝後驗證要求：
            </p>

            {/* 複製狀態明確回饋 */}
            {copyFeedback && (
              <div
                className={`text-xs px-3 py-2 rounded-lg flex items-center space-x-2 animate-in fade-in ${
                  copyFeedback.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}
              >
                {copyFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                )}
                <span>{copyFeedback.message}</span>
              </div>
            )}

            {/* 提示詞文字方塊 (可供檢視與手動反白複製) */}
            <div className="relative">
              <pre
                tabIndex={0}
                className="bg-slate-900 dark:bg-slate-950 text-slate-200 p-3.5 rounded-lg text-xs font-mono max-h-48 overflow-y-auto leading-relaxed border border-slate-800 dark:border-slate-800 whitespace-pre-wrap select-all focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {AGENT_INSTALL_PROMPT}
              </pre>
            </div>
          </div>

          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span>💡 提示：若剪貼簿受瀏覽器限制，可直接手動反白選取上方文字。</span>
          </div>
        </div>
      </div>
    </section>
  );
};
