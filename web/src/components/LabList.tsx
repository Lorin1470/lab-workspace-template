import React from 'react';
import { ExperimentConfig, ExperimentStatus } from '../types/index.ts';
import { ChevronRight, Users, PlusCircle, FolderGit2 } from 'lucide-react';

interface LabListProps {
  courseName: string;
  experiments: ExperimentConfig[];
  onSelectLab: (lab: ExperimentConfig) => void;
}

const statusMap: Record<ExperimentStatus, { label: string; badgeClass: string; icon: string }> = {
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

export const LabList: React.FC<LabListProps> = ({
  courseName,
  experiments,
  onSelectLab,
}) => {
  const completedCount = experiments.filter((e) => e.status === 'completed').length;

  return (
    <div className="space-y-6">
      {/* 課程總覽抬頭 */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-2 text-blue-600 text-xs font-semibold uppercase tracking-wider mb-1">
            <FolderGit2 className="w-4 h-4" />
            <span>課程實驗工作區索引</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">{courseName}</h2>
          <p className="text-sm text-slate-500 mt-1">
            共 {experiments.length} 個實驗專案｜已完成 {completedCount} 個
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="text-right">
            <span className="text-xs text-slate-400 block">整體進度</span>
            <span className="text-lg font-bold text-slate-800">
              {Math.round((completedCount / (experiments.length || 1)) * 100)}%
            </span>
          </div>
          <div className="w-24 bg-slate-100 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${(completedCount / (experiments.length || 1)) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* 實驗列表卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {experiments.map((exp) => {
          const statusInfo = statusMap[exp.status];
          return (
            <div
              key={exp.experiment_id}
              onClick={() => onSelectLab(exp)}
              className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md hover:border-blue-400 transition-all cursor-pointer flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-mono">
                    {exp.experiment_id.toUpperCase()}
                  </span>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full border flex items-center space-x-1 ${statusInfo.badgeClass}`}
                  >
                    <span>{statusInfo.icon}</span>
                    <span>{statusInfo.label}</span>
                  </span>
                </div>

                <h3 className="text-base font-semibold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                  {exp.experiment_name}
                </h3>

                <p className="text-xs text-slate-400 font-mono mt-1">
                  {exp.repository || `example-org/${exp.course_id.toLowerCase()}-${exp.experiment_id}`}
                </p>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <div className="flex items-center space-x-1.5">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span>{exp.members.map((m) => m.name).join('、')}</span>
                  </div>
                  <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] text-slate-600">
                    {exp.report_mode === 'shared' ? '共同報告' : '獨立報告'}
                  </span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-blue-600 font-medium">
                <span>進入實驗工作區</span>
                <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          );
        })}
      </div>

      {/* 快速建立新實驗引導卡片 */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start space-x-3">
          <div className="bg-blue-600 text-white p-2.5 rounded-lg mt-0.5">
            <PlusCircle className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-semibold text-slate-900">需要為下一節課建立新 Repo？</h4>
            <p className="text-sm text-slate-600 mt-0.5">
              使用標準 Template 建立乾淨獨立的實驗工作區，一律遵循一節課一 Repo 原則。
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <code className="text-xs bg-white text-slate-800 px-3 py-2 rounded-lg border border-slate-300 font-mono">
            npm run create-lab
          </code>
        </div>
      </div>
    </div>
  );
};
