import React, { useState } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { LabList } from './components/LabList.tsx';
import { LabDetail } from './components/LabDetail.tsx';
import { ExperimentConfig } from './types/index.ts';

// 示範課程與實驗工作區資料庫
const mockCoursesData: Record<string, ExperimentConfig[]> = {
  '電子學實驗': [
    {
      course_id: 'EE201',
      course_name: '電子學實驗',
      semester: '114-1',
      experiment_id: 'lab-01',
      experiment_name: '二極體特性曲線與整流電路',
      template_version: '1.0',
      skill_version: '1.0',
      report_mode: 'shared',
      status: 'completed',
      members: [
        { github: 'studentA', name: '學生A', role: '組長' },
        { github: 'studentB', name: '王小明', role: '組員' },
      ],
      created_at: '2026-09-10',
      repository: 'example-org/electronics-lab-01',
    },
    {
      course_id: 'EE201',
      course_name: '電子學實驗',
      semester: '114-1',
      experiment_id: 'lab-02',
      experiment_name: 'BJT 雙極性電晶體偏壓與特性量測',
      template_version: '1.0',
      skill_version: '1.0',
      report_mode: 'shared',
      status: 'report_writing',
      members: [
        { github: 'studentA', name: '學生A', role: '組長' },
        { github: 'studentB', name: '王小明', role: '組員' },
      ],
      created_at: '2026-09-17',
      repository: 'example-org/electronics-lab-02',
    },
    {
      course_id: 'EE201',
      course_name: '電子學實驗',
      semester: '114-1',
      experiment_id: 'lab-03',
      experiment_name: 'OP AMP 運算放大器反相與非反相放大',
      template_version: '1.0',
      skill_version: '1.0',
      report_mode: 'separate',
      status: 'in_progress',
      members: [
        { github: 'studentA', name: '學生A', role: '組長' },
        { github: 'studentB', name: '王小明', role: '組員' },
      ],
      created_at: '2026-09-18',
      repository: 'example-org/electronics-lab-03',
    },
    {
      course_id: 'EE201',
      course_name: '電子學實驗',
      semester: '114-1',
      experiment_id: 'lab-04',
      experiment_name: '主動式帶通濾波器設計與頻響量測',
      template_version: '1.0',
      skill_version: '1.0',
      report_mode: 'shared',
      status: 'not_started',
      members: [
        { github: 'studentA', name: '學生A', role: '組長' },
        { github: 'studentB', name: '王小明', role: '組員' },
      ],
      created_at: '2026-09-18',
      repository: 'example-org/electronics-lab-04',
    },
  ],
  '數位邏輯實驗': [
    {
      course_id: 'EE102',
      course_name: '數位邏輯實驗',
      semester: '114-1',
      experiment_id: 'lab-01',
      experiment_name: 'TTL 與 CMOS 基本邏輯閘電路量測',
      template_version: '1.0',
      skill_version: '1.0',
      report_mode: 'shared',
      status: 'completed',
      members: [
        { github: 'studentA', name: '學生A', role: '組長' },
      ],
      created_at: '2026-09-12',
      repository: 'example-org/digital-logic-lab-01',
    },
    {
      course_id: 'EE102',
      course_name: '數位邏輯實驗',
      semester: '114-1',
      experiment_id: 'lab-02',
      experiment_name: '全加法器與 7 段顯示器解碼驅動',
      template_version: '1.0',
      skill_version: '1.0',
      report_mode: 'shared',
      status: 'in_progress',
      members: [
        { github: 'studentA', name: '學生A', role: '組長' },
      ],
      created_at: '2026-09-18',
      repository: 'example-org/digital-logic-lab-02',
    },
  ],
};

export const App: React.FC = () => {
  const [selectedCourse, setSelectedCourse] = useState<string>('電子學實驗');
  const [selectedLab, setSelectedLab] = useState<ExperimentConfig | null>(null);

  const availableCourses = Object.keys(mockCoursesData);
  const currentExperiments = mockCoursesData[selectedCourse] || [];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Navbar
        currentCourse={selectedCourse}
        onSelectCourse={(course) => {
          setSelectedCourse(course);
          setSelectedLab(null);
        }}
        availableCourses={availableCourses}
        activeRepo={selectedLab?.repository || null}
        onBackToHome={() => setSelectedLab(null)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {selectedLab ? (
          <LabDetail lab={selectedLab} onBack={() => setSelectedLab(null)} />
        ) : (
          <LabList
            courseName={selectedCourse}
            experiments={currentExperiments}
            onSelectLab={(lab) => setSelectedLab(lab)}
          />
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        <p>實驗課 GitHub 工作區系統 • 一節課一 Repo 實驗協作體系 • Powered by Cloudflare Pages & GitHub API</p>
      </footer>
    </div>
  );
};

export default App;
