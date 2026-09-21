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
  if (currentExperiment) {
    return currentExperiment.repository || currentCourse?.github_repository || null;
  }
  return currentCourse?.github_repository || null;
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
 * - separate 模式: 使用目前登入者的個人報告 report/report-<github_id>.md
 */
export function getReportRelativePath(
  reportMode?: 'shared' | 'separate' | string,
  userGithubId?: string | number | null
): string {
  if (reportMode === 'separate' && userGithubId) {
    return `report/report-${userGithubId}.md`;
  }
  return 'report/report.md';
}

