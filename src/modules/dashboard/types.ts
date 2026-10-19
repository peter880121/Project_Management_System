export type DashboardStats = {
  generatedAt: string; timezone: string; scope: "GLOBAL" | "PARTICIPATING";
  metrics: { activeProjects: number; overdueTasks: number; unsignedTasks: number; archivedProjects: number };
  workload: { rows: { assigneeId: string; name: string; role: string; count: number }[]; unassigned: number; page: number; hasMore: boolean };
  health: { rows: { id: string; name: string; total: number; done: number; overdue: number; blocked: number; recentRisks: number; progress: number | null }[]; page: number; total: number };
  trend: { month: string; archivedProjects: number; deliverableVersions: number }[];
};
