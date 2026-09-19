import React from 'react';
import { ExperimentConfig } from '../types/index.ts';

interface LabDetailProps {
  lab: ExperimentConfig;
  onBack: () => void;
}

/**
 * Legacy compatibility surface.
 *
 * Real experiments are rendered by CourseDetail/ExperimentDetail. Keeping this
 * component data-free prevents the retired demo view from presenting fake
 * files, commits, or downloadable measurements.
 */
export const LabDetail: React.FC<LabDetailProps> = ({ lab, onBack }) => (
  <div className="space-y-4">
    <button
      onClick={onBack}
      className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
    >
      返回
    </button>
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-lg font-bold text-amber-900">此舊版實驗檢視器已停用</h2>
      <p className="mt-2 text-sm text-amber-800">
        「{lab.experiment_name}」請從正式課程流程開啟，以使用真實 GitHub Workspace、Activity Log 與 Agent workflow。
      </p>
    </section>
  </div>
);
