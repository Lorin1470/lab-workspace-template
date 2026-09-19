import {
  AuthUser,
  Course,
  CreateCourseRequest,
  UpdateCourseRequest,
  Experiment,
  CreateExperimentRequest,
  UpdateExperimentRequest,
  CourseMembership,
  AddCourseMemberRequest,
  UpdateCourseMemberRequest,
  ExperimentMembership,
  AddExperimentMemberRequest,
  UpdateExperimentMemberRequest,
  ActivityLogItem,
  CourseRole,
  ReportMode,
  ProvisionExperimentResponse,
} from '../types/index.ts';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = endpoint.startsWith('/') ? endpoint : `/api/${endpoint}`;
  const headers = new Headers(options.headers || {});

  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      if (data && data.error) {
        errorMsg = data.error;
      }
    } catch {
      // ignore json parse failure
    }
    throw new ApiError(errorMsg, response.status);
  }

  return response.json();
}

export const api = {
  // 身分驗證 (Auth)
  auth: {
    me: async (): Promise<{ authenticated: boolean; user?: AuthUser }> => {
      return request('/api/auth/me');
    },
    logout: async (): Promise<{ success: boolean }> => {
      return request('/api/auth/logout', { method: 'POST' });
    },
    loginUrl: '/api/auth/login',
  },

  // 課程管理 (Courses)
  courses: {
    list: async (): Promise<Course[]> => {
      const data = await request<{ success: boolean; courses: Course[] }>('/api/courses');
      return data.courses || [];
    },
    get: async (id: string): Promise<Course> => {
      const data = await request<{ success: boolean; course: Course }>(`/api/courses/${encodeURIComponent(id)}`);
      return data.course;
    },
    create: async (data: CreateCourseRequest): Promise<Course> => {
      const res = await request<{ success: boolean; course: Course }>('/api/courses', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return res.course;
    },
    update: async (id: string, data: UpdateCourseRequest): Promise<Course> => {
      const res = await request<{ success: boolean; course: Course }>(`/api/courses/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      return res.course;
    },
  },

  // 課程成員管理 (Course Memberships)
  courseMembers: {
    list: async (courseId: string): Promise<CourseMembership[]> => {
      const data = await request<{ success: boolean; members?: CourseMembership[]; course_members?: CourseMembership[] }>(
        `/api/courses/${encodeURIComponent(courseId)}/members`
      );
      return data.members || data.course_members || [];
    },
    add: async (courseId: string, data: AddCourseMemberRequest): Promise<CourseMembership> => {
      const res = await request<{ success: boolean; member: CourseMembership }>(
        `/api/courses/${encodeURIComponent(courseId)}/members`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      );
      return res.member;
    },
    update: async (
      courseId: string,
      memberId: string,
      data: UpdateCourseMemberRequest
    ): Promise<CourseMembership> => {
      const res = await request<{ success: boolean; member: CourseMembership }>(
        `/api/courses/${encodeURIComponent(courseId)}/members/${encodeURIComponent(memberId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(data),
        }
      );
      return res.member;
    },
  },

  // 實驗管理 (Experiments)
  experiments: {
    listByCourse: async (courseId: string): Promise<Experiment[]> => {
      const data = await request<{ success: boolean; experiments: Experiment[] }>(
        `/api/experiments?course_id=${encodeURIComponent(courseId)}`
      );
      return data.experiments || [];
    },
    get: async (
      id: string
    ): Promise<{
      experiment: Experiment;
      course?: Course;
      role?: CourseRole;
      report_mode?: ReportMode;
    }> => {
      const data = await request<{
        success: boolean;
        experiment: Experiment;
        course?: Course;
        role?: CourseRole;
        report_mode?: ReportMode;
      }>(`/api/experiments/${encodeURIComponent(id)}`);
      return {
        experiment: data.experiment,
        course: data.course,
        role: data.role,
        report_mode: data.report_mode,
      };
    },
    create: async (data: CreateExperimentRequest): Promise<Experiment> => {
      const res = await request<{ success: boolean; experiment: Experiment }>('/api/experiments', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return res.experiment;
    },
    update: async (id: string, data: UpdateExperimentRequest): Promise<Experiment> => {
      const res = await request<{ success: boolean; experiment: Experiment }>(
        `/api/experiments/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(data),
        }
      );
      return res.experiment;
    },
    provision: async (id: string): Promise<ProvisionExperimentResponse> => {
      return await request<ProvisionExperimentResponse>(
        `/api/experiments/${encodeURIComponent(id)}/provision`,
        { method: 'POST' }
      );
    },
    getProvisioning: async (
      id: string
    ): Promise<{
      success: boolean;
      experiment_id: string;
      repository: string;
      provisioning_status: string;
      provisioning_error: string | null;
      provisioned_at: string | null;
      history: any[];
    }> => {
      return await request(
        `/api/experiments/${encodeURIComponent(id)}/provision`,
        { method: 'GET' }
      );
    },
  },

  // 實驗成員管理 (Experiment Memberships)
  experimentMembers: {
    list: async (experimentId: string): Promise<ExperimentMembership[]> => {
      const data = await request<{ success: boolean; experiment_members: ExperimentMembership[] }>(
        `/api/experiments/${encodeURIComponent(experimentId)}/members`
      );
      return data.experiment_members || [];
    },
    add: async (
      experimentId: string,
      data: AddExperimentMemberRequest
    ): Promise<ExperimentMembership> => {
      const res = await request<{ success: boolean; member: ExperimentMembership }>(
        `/api/experiments/${encodeURIComponent(experimentId)}/members`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      );
      return res.member;
    },
    update: async (
      experimentId: string,
      memberId: string,
      data: UpdateExperimentMemberRequest
    ): Promise<ExperimentMembership> => {
      const res = await request<{ success: boolean; member: ExperimentMembership }>(
        `/api/experiments/${encodeURIComponent(experimentId)}/members/${encodeURIComponent(memberId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(data),
        }
      );
      return res.member;
    },
  },

  // 活動紀錄 (Activity Logs)
  activity: {
    list: async (
      repo: string,
      exp?: string,
      limit: number = 50
    ): Promise<{ logs: ActivityLogItem[]; mode?: string }> => {
      let url = `/api/activity?repo=${encodeURIComponent(repo)}&limit=${limit}`;
      if (exp) {
        url += `&exp=${encodeURIComponent(exp)}`;
      }
      const data = await request<{ success: boolean; logs: ActivityLogItem[]; mode?: string }>(url);
      return {
        logs: data.logs || [],
        mode: data.mode,
      };
    },
  },
};
