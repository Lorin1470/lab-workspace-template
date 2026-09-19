export type AgentTaskIntent = 'report_update' | 'workspace_review' | 'photo_review';

export interface AgentTaskClassification {
  intent: AgentTaskIntent | null;
  unsupportedReason?: string;
}

export interface WorkspaceReviewInput {
  experimentName: string;
  reportPath: string;
  reportExists: boolean;
  readmeExists: boolean;
  rawItemCount: number;
  photoItemCount: number;
}

export function classifyAgentTask(prompt: string): AgentTaskClassification {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return { intent: null, unsupportedReason: '任務內容不可為空。' };

  const asksForReportUpdate = /(更新|補充|撰寫|整理進報告|update|write.*report|report.*update)/i.test(normalized);
  if (/(報告|report|結果|discussion|結論)/i.test(normalized) && asksForReportUpdate) {
    return { intent: 'report_update' };
  }

  if (/(缺|不足|檢查|檢視|完成|還有什麼|missing|incomplete|check|complete)/i.test(normalized)) {
    return { intent: 'workspace_review' };
  }

  if (/(照片|相片|photo|整理照片|organize.*photo)/i.test(normalized)) {
    return { intent: 'photo_review' };
  }

  return {
    intent: null,
    unsupportedReason: '目前支援：檢查 Workspace 完成度、檢視照片整理狀態，或根據 Workspace 資料更新報告。',
  };
}

export function buildWorkspaceReview(input: WorkspaceReviewInput): {
  summary: string;
  findings: string[];
  warnings: string[];
} {
  const findings: string[] = [];
  if (!input.readmeExists) findings.push('缺少 README.md 實驗說明。');
  if (!input.reportExists) findings.push(`尚未建立 ${input.reportPath}。`);
  if (input.rawItemCount === 0) findings.push('raw/ 目前沒有原始量測資料。');
  if (input.photoItemCount === 0) findings.push('photos/ 目前沒有實驗照片。');

  return {
    summary:
      findings.length > 0
        ? `${input.experimentName} 目前有 ${findings.length} 項可補齊事項。`
        : `${input.experimentName} 的基本 Workspace 資料目前看起來完整。`,
    findings,
    warnings: [
      '這是唯讀檢查，不會修改 GitHub repository，也不會產生 commit。',
      'Agent 不會猜測未上傳的本機 Desktop 檔案或實驗數值。',
    ],
  };
}
