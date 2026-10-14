import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { SkillDownloadGuide } from './SkillDownloadGuide.tsx';

interface SkillDownloadPageProps {
  onBack: () => void;
  onError?: (msg: string) => void;
  onSuccess?: (msg: string) => void;
}

export const SkillDownloadPage: React.FC<SkillDownloadPageProps> = ({
  onBack,
  onError,
  onSuccess,
}) => {
  return (
    <div className="space-y-6">
      {/* 頂部操作與返回列 */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center space-x-2 text-xs font-semibold text-slate-600 hover:text-blue-600 bg-white border border-slate-200 hover:border-blue-300 px-3.5 py-2 rounded-xl transition-colors cursor-pointer shadow-xs"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>返回課程列表</span>
        </button>

        <div className="text-xs text-slate-400 font-mono hidden sm:block">
          /skill-download
        </div>
      </div>

      {/* 集中式下載與 Agent 安裝引導核心區塊 */}
      <SkillDownloadGuide onError={onError} onSuccess={onSuccess} />
    </div>
  );
};
