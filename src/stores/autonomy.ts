import { create } from 'zustand'
import { api, type ApiAutonomyProjectSnapshot, type ApiProject } from '@/api/client'

/**
 * Phase 5 (four-layer architecture): the Autonomy view reads the project
 * snapshot and projects a Work Item into responsible Personas, execution,
 * verification, and approval. This store mirrors the shipping store's
 * list + detail + cache shape.
 */
interface AutonomyState {
  projects: ApiProject[]
  projectsLoaded: boolean
  selectedProjectId: string | null
  snapshot: ApiAutonomyProjectSnapshot | null
  selectedWorkItemId: string | null
  loading: boolean
  error: string | null
  /** Set after a write action fails, so the detail panel can surface it. */
  actionError: string | null
  loadProjects: () => Promise<void>
  selectProject: (projectId: string) => Promise<void>
  refresh: () => Promise<void>
  selectWorkItem: (workItemId: string | null) => void
  decideApproval: (approvalId: string, decision: 'approved' | 'rejected', note?: string) => Promise<void>
  assignResponsibility: (runId: string, responsibility: string, personaAgentId: string) => Promise<void>
  submitReview: (runId: string, input: { personaAgentId: string; responsibility: string; verdict: 'passed' | 'failed'; summary: string }) => Promise<void>
}

async function loadSnapshot(
  set: (partial: Partial<AutonomyState>) => void,
  projectId: string,
  keepSelection: string | null,
): Promise<void> {
  set({ loading: true, error: null })
  try {
    const snapshot = await api.getAutonomyProject(projectId)
    const selectedWorkItemId = keepSelection && snapshot.workItems.some((w) => w.id === keepSelection)
      ? keepSelection
      : snapshot.workItems[0]?.id ?? null
    set({ snapshot, selectedProjectId: projectId, selectedWorkItemId, loading: false })
  } catch (error) {
    set({
      snapshot: null,
      loading: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export const useAutonomy = create<AutonomyState>((set, get) => ({
  projects: [],
  projectsLoaded: false,
  selectedProjectId: null,
  snapshot: null,
  selectedWorkItemId: null,
  loading: false,
  error: null,
  actionError: null,
  async loadProjects() {
    try {
      const projects = await api.listProjects()
      set({ projects, projectsLoaded: true })
      const current = get().selectedProjectId
      const target = current && projects.some((p) => p.id === current) ? current : projects[0]?.id
      if (target) await loadSnapshot(set, target, get().selectedWorkItemId)
    } catch (error) {
      set({ projectsLoaded: true, error: error instanceof Error ? error.message : String(error) })
    }
  },
  async selectProject(projectId) {
    if (projectId === get().selectedProjectId) return
    set({ selectedProjectId: projectId, selectedWorkItemId: null })
    await loadSnapshot(set, projectId, null)
  },
  async refresh() {
    const projectId = get().selectedProjectId
    if (projectId) await loadSnapshot(set, projectId, get().selectedWorkItemId)
  },
  selectWorkItem(workItemId) {
    set({ selectedWorkItemId: workItemId, actionError: null })
  },
  async decideApproval(approvalId, decision, note) {
    await runAction(set, () => api.decideAutonomyApproval(approvalId, { decision, note }))
    await get().refresh()
  },
  async assignResponsibility(runId, responsibility, personaAgentId) {
    const projectId = get().selectedProjectId
    if (!projectId) return
    await runAction(set, () => api.assignAutonomyResponsibility(projectId, runId, { responsibility, personaAgentId }))
    await get().refresh()
  },
  async submitReview(runId, input) {
    await runAction(set, () => api.submitAutonomyReview(runId, { ...input, submission: 'review_evidence' }))
    await get().refresh()
  },
}))

/** Run a write action, capturing any error into `actionError` and rethrowing so
 *  callers can keep a form open on failure. */
async function runAction(set: (partial: Partial<AutonomyState>) => void, fn: () => Promise<unknown>): Promise<void> {
  set({ actionError: null })
  try {
    await fn()
  } catch (error) {
    set({ actionError: error instanceof Error ? error.message : String(error) })
    throw error
  }
}
