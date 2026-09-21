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

export type ActorType = 'user' | 'agent' | 'web';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'none';

export interface ActivityLogItem {
  id: string;
  repo_name: string;
  experiment_id: string;
  timestamp: string;
  actor_type: ActorType;
  actor_id: string;
  actor_name: string;
  actor_avatar?: string;
  requested_by?: string;
  approved_by?: string;
  approval_status?: ApprovalStatus;
  action: string;
  target?: string;
  summary: string;
  files_changed?: string;
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

export interface AuthUser {
  github_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export type CourseRole = 'teacher' | 'assistant' | 'student' | 'guest';
export type ExperimentRole = 'assistant' | 'student';
export type CourseMode = 'course' | 'experiment';

export interface Course {
  id: string;
  course_code: string;
  name: string;
  semester: string;
  status: 'active' | 'archived' | 'inactive';
  mode?: CourseMode;
  github_repository?: string | null;
  created_by_github_id?: string | null;
  created_at: string;
  updated_at: string;
  role?: CourseRole;
}

export interface CreateCourseRequest {
  course_code: string;
  name: string;
  semester: string;
  mode?: CourseMode;
  github_repository?: string;
}

export interface UpdateCourseRequest {
  name?: string;
  semester?: string;
  status?: 'active' | 'archived' | 'inactive';
}

export interface CreateExperimentRequest {
  course_id: string;
  experiment_code: string;
  name: string;
  repository?: string;
  report_mode?: ReportMode;
}

export interface UpdateExperimentRequest {
  name?: string;
  report_mode?: ReportMode;
  status?: ExperimentStatus;
}

export interface AddCourseMemberRequest {
  github_id: string;
  username: string;
  role: 'teacher' | 'assistant' | 'student';
}

export interface UpdateCourseMemberRequest {
  role?: 'teacher' | 'assistant' | 'student';
  status?: 'active' | 'inactive' | 'suspended';
  username?: string;
}

export interface AddExperimentMemberRequest {
  github_id: string;
  username: string;
  role: 'student' | 'assistant';
  group_name?: string;
}

export interface UpdateExperimentMemberRequest {
  group_name?: string;
  status?: 'active' | 'inactive';
  role?: 'student' | 'assistant';
}

export type ProvisioningStatus = 'pending' | 'creating' | 'ready' | 'failed';

export interface ExperimentProvisioning {
  id: string;
  experiment_id: string;
  repository: string;
  status: ProvisioningStatus;
  error_summary?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProvisionExperimentResponse {
  success: boolean;
  status: ProvisioningStatus;
  already_existed?: boolean;
  message?: string;
  repository?: {
    owner: string;
    name: string;
    full_name: string;
    html_url: string;
    default_branch: string;
  };
  experiment?: Experiment;
  error?: string;
  details?: string;
}

export interface Experiment {
  id: string;
  course_id: string;
  experiment_code: string;
  name: string;
  repository: string | null;
  report_mode: ReportMode;
  config_version: string;
  status: ExperimentStatus;
  provisioning_status?: ProvisioningStatus;
  provisioning_error?: string | null;
  provisioned_at?: string | null;
  created_at: string;
  updated_at: string;
  group_name?: string | null;
}

export interface CourseMembership {
  id: string;
  course_id: string;
  github_id: string;
  username: string;
  role: CourseRole;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ExperimentMembership {
  id: string;
  experiment_id: string;
  github_id: string;
  username: string;
  role: ExperimentRole;
  group_name?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PermissionResult {
  allowed: boolean;
  role: CourseRole;
  reason?: string;
  course?: Course | null;
  experiment?: Experiment | null;
  report_mode?: ReportMode;
}

// ==========================================
// 實驗工作區 (Workspace) API 型別
// ==========================================

export interface WorkspaceFileItem {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'directory';
  size?: number;
  sha?: string;
}

export interface WorkspaceFileContent {
  name: string;
  path: string;
  size: number;
  encoding: string;
  content: string;
  content_base64?: string;
  sha: string;
  type: 'file';
}

export interface WorkspaceWriteResponse {
  success: boolean;
  path: string;
  action: string;
  commit_sha: string;
  content_sha: string;
}
