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
  loadProjects: () => Promise<void>
  selectProject: (projectId: string) => Promise<void>
  refresh: () => Promise<void>
  selectWorkItem: (workItemId: string | null) => void
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
    set({ selectedWorkItemId: workItemId })
  },
}))
