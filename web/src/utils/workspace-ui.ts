import type { Course, Experiment } from '../types/index.ts';

/**
 * 解析導覽列 (Navbar) 應顯示的 Repository 名稱
 * - Experiment Mode: 優先使用 experiment.repository
 * - Course Mode: 當 experiment.repository 為 null 時，自動 fallback 至 course.github_repository
 * - 絕不包含 scoped path (experiments/<code>/)
 */
export function resolveNavbarRepository(
  currentExperiment: Experiment | null,
  currentCourse: Course | null
): string | null {
  const mode = currentCourse?.mode || 'experiment';
  if (mode === 'course') {
    // 課程模式：一律使用 course.github_repository，個別實驗不應獨立綁定 repo
    return currentCourse?.github_repository || null;
  }
  if (currentExperiment) {
    // 實驗模式：必須優先使用 experiment.repository；若 experiment.repository 缺失，嚴禁意外 fallback 至 course.github_repository
    return currentExperiment.repository || null;
  }
  return null;
}

/**
 * 判定「開啟實驗工作區」導覽目標分頁
 * 確保點擊「開啟實驗工作區」CTA 直接前往工作區分頁 ('files')
 */
export function resolveInitialExperimentTab(
  requestedTab?: 'activity' | 'members' | 'report' | 'files' | 'upload' | 'download' | 'agent'
): 'activity' | 'members' | 'report' | 'files' | 'upload' | 'download' | 'agent' {
  return requestedTab || 'files';
}

/**
 * 判定是否應向使用者展示「尚未建立遠端儲存庫」的獨立建立警告
 * - Course Mode: 只要課程本身已設定 github_repository，個別實驗絕不展示獨立建立警告
 * - Experiment Mode: 若 provisioning_status 為 pending，則展示引導警告
 */
export function shouldShowStandaloneProvisioningWarning(
  courseMode: 'course' | 'experiment' | string | undefined,
  courseRepo: string | null | undefined,
  expProvisioningStatus: string | null | undefined
): boolean {
  if (courseMode === 'course' && courseRepo) {
    return false;
  }
  return !expProvisioningStatus || expProvisioningStatus === 'pending';
}

/**
 * 格式化實驗報告路徑 (Client 端維持乾淨相對路徑，絕不混入後端 scoped path)
 * - shared 模式: 固定使用 report/report.md
 * - separate 模式: 必須要求有效的 GitHub ID，產生 report/report-<github_id>.md
 *   若 separate 模式缺失有效的 github_id，回傳 null（避免靜默 fallback 到 shared report 掩蓋登入或身分遺失錯誤）
 */
export function getReportRelativePath(
  reportMode?: 'shared' | 'separate' | string,
  userGithubId?: string | number | null
): string | null {
  if (reportMode === 'separate') {
    if (userGithubId !== undefined && userGithubId !== null && String(userGithubId).trim() !== '') {
      return `report/report-${String(userGithubId).trim()}.md`;
    }
    // separate 模式但缺少有效 github_id：明確回傳 null，不可靜默 fallback 至 report/report.md
    return null;
  }
  return 'report/report.md';
}

