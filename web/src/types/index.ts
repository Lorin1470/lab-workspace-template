export type ExperimentStatus =
  | 'not_started'
  | 'in_progress'
  | 'data_processing'
  | 'report_writing'
  | 'completed';

export type ReportMode = 'shared' | 'separate';

export interface Member {
  github: string;
  name: string;
  role: string;
}

export interface ExperimentConfig {
  course_id: string;
  course_name: string;
  semester: string;
  experiment_id: string;
  experiment_name: string;
  template_version: string;
  skill_version: string;
  report_mode: ReportMode;
  status: ExperimentStatus;
  members: Member[];
  created_at: string;
  repository?: string;
}

export interface ActivityLogItem {
  id: string;
  repo_name: string;
  experiment_id: string;
  timestamp: string;
  actor_type: 'user' | 'agent' | 'web';
  actor_id: string;
  actor_name: string;
  actor_avatar?: string;
  requested_by?: string;
  approved_by?: string;
  action: string;
  summary: string;
  commit_sha?: string;
  details_json?: string;
}

export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  category: 'raw' | 'photos' | 'processed' | 'analysis' | 'report' | 'root';
}

export interface CommitItem {
  sha: string;
  message: string;
  author: string;
  date: string;
  url?: string;
}
