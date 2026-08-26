import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/i18n'
import { useAutonomy } from '@/stores/autonomy'
import { useAuth } from '@/stores/auth'
import { useParticipants } from '@/stores/participants'
import { Avatar } from '@/components/Avatar'
import { ILayers, IRefresh } from '@/components/icons'
import { cn } from '@/lib/utils'
import type {
  ApiAutonomyApproval,
  ApiAutonomyAssignment,
  ApiAutonomyPlan,
  ApiAutonomyProjectSnapshot,
  ApiAutonomyReview,
  ApiAutonomyWorkItem,
} from '@/api/client'

function humanize(value: string): string {
  return value.replace(/[_:]/g, ' ')
}

/** Responsibilities a human can bind to a run. */
const RESPONSIBILITIES = [
  'planner', 'researcher', 'builder_owner', 'design_reviewer',
  'independent_verifier', 'deployment_operator', 'readback_operator',
] as const
const REVIEW_RESPONSIBILITIES = new Set(['planner', 'researcher', 'design_reviewer', 'independent_verifier'])

type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'blue'

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: Tone }) {
  const colors: Record<Tone, string> = {
    neutral: 'bg-ink-50 text-ink-600', good: 'bg-emerald-50 text-emerald-700',
    bad: 'bg-coral-soft/40 text-coral-deep', warn: 'bg-gold/15 text-amber-700', blue: 'bg-sky2-50 text-skype-deep',
  }
  return <span className={cn('inline-flex rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[.08em]', colors[tone])}>{children}</span>
}

function statusTone(status: string): Tone {
  if (status === 'completed') return 'good'
  if (status === 'failed' || status === 'blocked' || status === 'cancelled') return 'bad'
  if (status === 'awaiting_merge' || status === 'verifying' || status === 'watching') return 'warn'
  return 'blue'
}

function fieldClass() {
  return 'w-full rounded-lg border border-ink-100 bg-white px-2.5 py-1.5 text-[12px] text-ink-900 outline-none transition focus:border-skype'
}

function Button({ children, onClick, disabled, tone = 'default' }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'default' | 'primary' | 'danger' | 'success'
}) {
  const tones = {
    default: 'border-ink-100 bg-white text-ink-700 hover:bg-sky2-50',
    primary: 'border-skype bg-skype text-white hover:bg-skype-deep',
    danger: 'border-coral/30 bg-coral-soft/30 text-coral-deep hover:bg-coral-soft/60',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  }
  return <button type="button" onClick={onClick} disabled={disabled} className={cn('rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45', tones[tone])}>{children}</button>
}

function runAction(promise: Promise<unknown>, onSuccess?: () => void) {
  void promise.then(onSuccess).catch(() => { /* actionError is rendered by the store */ })
}

export function AutonomyWorkspace() {
  const { t } = useI18n()
  const projects = useAutonomy((s) => s.projects)
  const projectsLoaded = useAutonomy((s) => s.projectsLoaded)
  const selectedProjectId = useAutonomy((s) => s.selectedProjectId)
  const snapshot = useAutonomy((s) => s.snapshot)
  const selectedWorkItemId = useAutonomy((s) => s.selectedWorkItemId)
  const loading = useAutonomy((s) => s.loading)
  const error = useAutonomy((s) => s.error)
  const loadProjects = useAutonomy((s) => s.loadProjects)
  const selectProject = useAutonomy((s) => s.selectProject)
  const selectWorkItem = useAutonomy((s) => s.selectWorkItem)
  const refresh = useAutonomy((s) => s.refresh)

  useEffect(() => { if (!projectsLoaded) void loadProjects() }, [projectsLoaded, loadProjects])

  const workItem = snapshot?.workItems.find((w) => w.id === selectedWorkItemId) ?? null

  return (
    <div className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] bg-[#F7FAFC]">
      <aside className="h-full overflow-y-auto border-r border-ink-100 bg-cloud">
        <div className="sticky top-0 z-10 border-b border-ink-100 bg-cloud/95 px-4 py-4 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[18px] font-semibold text-ink-900">{t('autonomy.title')}</h1>
              <p className="mt-0.5 text-[11px] text-ink-400">{t('autonomy.subtitle')}</p>
            </div>
            <button
              onClick={() => void refresh()}
              className="grid h-8 w-8 place-items-center rounded-lg border border-ink-100 bg-white text-ink-500 hover:text-skype-deep"
              aria-label={t('autonomy.refresh')} title={t('autonomy.refresh')}
            ><IRefresh className="h-4 w-4" /></button>
          </div>
          <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-ink-400">
            {t('autonomy.project')}
            <select
              className="mt-1 w-full rounded-xl border border-ink-100 bg-white px-3 py-2 text-[13px] text-ink-900 outline-none focus:border-skype"
              value={selectedProjectId ?? ''}
              onChange={(e) => void selectProject(e.target.value)}
            >
              {projects.length === 0 && <option value="">{t('autonomy.noProjects')}</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        <div className="p-2">
          {(snapshot?.workItems ?? []).map((item) => (
            <button
              key={item.id}
              onClick={() => selectWorkItem(item.id)}
              className={cn('mb-1 w-full rounded-xl px-3 py-3 text-left transition',
                selectedWorkItemId === item.id ? 'bg-sky2-50 ring-1 ring-sky2-200' : 'hover:bg-ink-50')}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-semibold text-ink-900">{item.goal}</span>
                <Pill tone={statusTone(item.status)}>{humanize(item.status)}</Pill>
              </div>
              <div className="mt-1.5 text-[10px] text-ink-400">{humanize(item.priority)} · {humanize(item.riskLevel)} {t('autonomy.risk')}</div>
            </button>
          ))}
          {snapshot && snapshot.workItems.length === 0 && (
            <Empty title={t('autonomy.noWorkItems')} />
          )}
          {!snapshot && !loading && (
            <Empty title={t('autonomy.unavailable')} detail={error ?? t('autonomy.unavailableDetail')} />
          )}
        </div>
      </aside>

      <main className="h-full min-w-0 overflow-y-auto">
        {loading && !snapshot ? <Centered title={t('autonomy.loading')} />
          : workItem && snapshot ? <WorkItemDetail workItem={workItem} snapshot={snapshot} />
            : <Centered title={t('autonomy.selectWorkItem')} />}
      </main>
    </div>
  )
}

function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="px-6 py-16 text-center">
      <ILayers className="mx-auto h-9 w-9 text-ink-300" />
      <div className="mt-3 text-[13px] font-semibold text-ink-700">{title}</div>
      {detail && <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{detail}</p>}
    </div>
  )
}

function Centered({ title }: { title: string }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div><ILayers className="mx-auto h-10 w-10 text-ink-300" /><div className="mt-3 text-[13px] font-semibold text-ink-700">{title}</div></div>
    </div>
  )
}

function Section({ eyebrow, title, hint, children }: { eyebrow: string; title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-2xl border border-ink-100 bg-white p-4 shadow-soft md:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[.18em] text-skype-deep">{eyebrow}</div>
          <h2 className="mt-1 text-[16px] font-semibold text-ink-900">{title}</h2>
        </div>
        {hint && <div className="text-[10px] text-ink-400">{hint}</div>}
      </div>
      {children}
    </section>
  )
}

function PersonaRow({ personaAgentId, personaName, responsibility }: {
  personaAgentId: string; personaName: string | null; responsibility: string
}) {
  const participant = useParticipants((s) => s.byId[personaAgentId])
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ink-100 bg-[#FAFCFD] px-3 py-2.5">
      {participant
        ? <Avatar p={participant} size={30} showStatus={false} />
        : <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-sky2-100 text-[12px] font-bold text-skype-deep">{(personaName ?? personaAgentId).charAt(0).toUpperCase()}</span>}
      <div className="min-w-0">
        <div className="truncate text-[12px] font-semibold text-ink-800">{personaName ?? personaAgentId}</div>
        <div className="text-[10px] text-ink-400">{humanize(responsibility)}</div>
      </div>
    </div>
  )
}

function WorkItemDetail({ workItem, snapshot }: { workItem: ApiAutonomyWorkItem; snapshot: ApiAutonomyProjectSnapshot }) {
  const { t } = useI18n()
  const role = useAuth((s) => s.companies.find((c) => c.id === s.activeCompanyId)?.role)
  const canManage = role === 'owner' || role === 'admin'
  const actionError = useAutonomy((s) => s.actionError)

  const assignments = snapshot.assignments.filter((a) => a.workItemId === workItem.id)
  const personas = assignments.filter((a) => a.personaAgentId)
  const execution = assignments.filter((a) => a.workerId || a.computerId)
  const reviews = snapshot.reviews.filter((r) => r.workItemId === workItem.id)
  const approvals = snapshot.approvals.filter((a) => a.workItemId === workItem.id)
  const plan = snapshot.plans.find((p) => p.workItemId === workItem.id) as ApiAutonomyPlan | undefined
  const pendingApproval = approvals.find((a) => a.status === 'pending')
  const runId = assignments[0]?.runId
    ?? snapshot.events.find((e) => e.workItemId === workItem.id && e.runId)?.runId
    ?? null
  const reviewers = personas.filter((a) => REVIEW_RESPONSIBILITIES.has(a.responsibility))

  const attemptByRun = new Map<string, number>()
  for (const event of snapshot.events) {
    if (event.kind === 'run.leased' && event.runId && typeof event.data?.attempt === 'number') {
      attemptByRun.set(event.runId, event.data.attempt as number)
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-5 md:px-7 md:py-7">
      <header className="rounded-2xl border border-ink-100 bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={statusTone(workItem.status)}>{humanize(workItem.status)}</Pill>
          <Pill tone={workItem.riskLevel === 'critical' || workItem.riskLevel === 'high' ? 'warn' : 'neutral'}>{humanize(workItem.riskLevel)} {t('autonomy.risk')}</Pill>
          {snapshot.project.contractHash && (
            <Pill tone="neutral">{t('autonomy.contract')} {snapshot.project.contractHash.slice(0, 8)}</Pill>
          )}
        </div>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-ink-900">{workItem.goal}</h1>
        <p className="mt-2 text-[11px] text-ink-500">
          <span className="font-bold uppercase tracking-wide text-skype-deep">{t('autonomy.nextGate')}: </span>
          {pendingApproval
            ? <>{humanize(pendingApproval.action)} · {t('autonomy.waitingFor', { role: humanize(pendingApproval.requiredRole) })}</>
            : humanize(workItem.status)}
        </p>
        {actionError && <div role="alert" className="mt-3 rounded-xl border border-coral/20 bg-coral-soft/20 px-3 py-2 text-[11px] text-coral-deep">{actionError}</div>}
      </header>

      <Section eyebrow="01" title={t('autonomy.responsiblePersonas')} hint={t('autonomy.responsiblePersonasHint')}>
        {personas.length === 0
          ? <p className="text-[11px] text-ink-400">{t('autonomy.noPersonas')}</p>
          : <div className="grid gap-2 md:grid-cols-2">{personas.map((a) => (
              <PersonaRow key={`${a.runId}-${a.responsibility}`} personaAgentId={a.personaAgentId as string} personaName={a.personaName} responsibility={a.responsibility} />
            ))}</div>}
        {canManage && runId && <AssignForm runId={runId} />}
      </Section>

      <Section eyebrow="02" title={t('autonomy.execution')} hint={t('autonomy.executionHint')}>
        {execution.length === 0
          ? <p className="text-[11px] text-ink-400">{t('autonomy.noExecution')}</p>
          : <div className="space-y-2">{execution.map((a) => <ExecutionRow key={`${a.runId}-${a.responsibility}`} assignment={a} attempt={attemptByRun.get(a.runId)} />)}</div>}
      </Section>

      <Section eyebrow="03" title={t('autonomy.verification')} hint={t('autonomy.verificationHint')}>
        {reviews.length === 0
          ? <p className="text-[11px] text-ink-400">{t('autonomy.noVerification')}</p>
          : <div className="space-y-2">{reviews.map((r) => <ReviewRow key={r.id} review={r} />)}</div>}
        {canManage && runId && reviewers.length > 0 && <ReviewForm runId={runId} reviewers={reviewers} />}
      </Section>

      <Section eyebrow="04" title={t('autonomy.approval')} hint={t('autonomy.approvalHint')}>
        {approvals.length === 0
          ? <p className="text-[11px] text-ink-400">{t('autonomy.noApproval')}</p>
          : <div className="space-y-2">{approvals.map((a) => <ApprovalRow key={a.id} approval={a} canManage={canManage} />)}</div>}
      </Section>

      {plan && <PlanSection plan={plan} />}
    </div>
  )
}

function AssignForm({ runId }: { runId: string }) {
  const { t } = useI18n()
  const assign = useAutonomy((s) => s.assignResponsibility)
  const byId = useParticipants((s) => s.byId)
  const agents = useMemo(() => Object.values(byId).filter((p) => p.kind === 'agent' && !p.departedAt), [byId])
  const [responsibility, setResponsibility] = useState<string>('builder_owner')
  const [personaAgentId, setPersonaAgentId] = useState<string>('')
  const submit = () => {
    if (!personaAgentId) return
    runAction(assign(runId, responsibility, personaAgentId), () => setPersonaAgentId(''))
  }
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-sky2-200 bg-sky2-50/50 p-3">
      <label className="text-[10px] font-bold uppercase tracking-wide text-ink-400">
        {t('autonomy.responsibility')}
        <select className={cn(fieldClass(), 'mt-1 md:w-44')} value={responsibility} onChange={(e) => setResponsibility(e.target.value)}>
          {RESPONSIBILITIES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
        </select>
      </label>
      <label className="text-[10px] font-bold uppercase tracking-wide text-ink-400">
        {t('autonomy.persona')}
        <select className={cn(fieldClass(), 'mt-1 md:w-44')} value={personaAgentId} onChange={(e) => setPersonaAgentId(e.target.value)}>
          <option value="">{t('autonomy.selectPersona')}</option>
          {agents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <Button tone="primary" disabled={!personaAgentId} onClick={submit}>{t('autonomy.assign')}</Button>
    </div>
  )
}

function ReviewForm({ runId, reviewers }: { runId: string; reviewers: ApiAutonomyAssignment[] }) {
  const { t } = useI18n()
  const submitReview = useAutonomy((s) => s.submitReview)
  const [reviewerKey, setReviewerKey] = useState<string>(`${reviewers[0].personaAgentId}:${reviewers[0].responsibility}`)
  const [verdict, setVerdict] = useState<'passed' | 'failed'>('passed')
  const [summary, setSummary] = useState('')
  const submit = () => {
    const [personaAgentId, responsibility] = reviewerKey.split(':')
    if (!personaAgentId || !summary.trim()) return
    runAction(submitReview(runId, { personaAgentId, responsibility, verdict, summary: summary.trim() }), () => setSummary(''))
  }
  return (
    <div className="mt-3 rounded-xl border border-sky2-200 bg-sky2-50/50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[10px] font-bold uppercase tracking-wide text-ink-400">
          {t('autonomy.reviewer')}
          <select className={cn(fieldClass(), 'mt-1 md:w-52')} value={reviewerKey} onChange={(e) => setReviewerKey(e.target.value)}>
            {reviewers.map((a) => (
              <option key={`${a.personaAgentId}:${a.responsibility}`} value={`${a.personaAgentId}:${a.responsibility}`}>
                {a.personaName ?? a.personaAgentId} · {humanize(a.responsibility)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-bold uppercase tracking-wide text-ink-400">
          {t('autonomy.verdict')}
          <select className={cn(fieldClass(), 'mt-1 md:w-32')} value={verdict} onChange={(e) => setVerdict(e.target.value as 'passed' | 'failed')}>
            <option value="passed">{t('autonomy.passed')}</option>
            <option value="failed">{t('autonomy.failed')}</option>
          </select>
        </label>
      </div>
      <input className={cn(fieldClass(), 'mt-2')} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t('autonomy.reviewSummaryPlaceholder')} />
      <div className="mt-2 flex justify-end"><Button tone="primary" disabled={!summary.trim()} onClick={submit}>{t('autonomy.submitReview')}</Button></div>
    </div>
  )
}

function ExecutionRow({ assignment, attempt }: { assignment: ApiAutonomyAssignment; attempt?: number }) {
  const { t } = useI18n()
  return (
    <div className="rounded-xl border border-ink-100 bg-[#FAFCFD] px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold text-ink-800">{assignment.workerId ?? assignment.computerId}</div>
        <Pill tone="neutral">{humanize(assignment.responsibility)}</Pill>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-500">
        {assignment.engine && <span>{t('autonomy.engine')}: {assignment.engine}</span>}
        {assignment.computerId && <span>{t('autonomy.host')}: {assignment.computerId}</span>}
        {attempt !== undefined && <span>{t('autonomy.attempt')}: {attempt}</span>}
        <span>{humanize(assignment.visibility)}</span>
      </div>
    </div>
  )
}

function ReviewRow({ review }: { review: ApiAutonomyReview }) {
  const tone: Tone = review.status === 'passed' ? 'good' : review.status === 'failed' ? 'bad' : 'neutral'
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-ink-100 bg-[#FAFCFD] px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-[12px] font-semibold text-ink-800">{humanize(review.kind)}</div>
        <div className="text-[10px] text-ink-400">{review.producerName ?? review.producerId ?? '—'}</div>
      </div>
      <Pill tone={tone}>{humanize(review.status)}</Pill>
    </div>
  )
}

function ApprovalRow({ approval, canManage }: { approval: ApiAutonomyApproval; canManage: boolean }) {
  const { t } = useI18n()
  const decide = useAutonomy((s) => s.decideApproval)
  const [note, setNote] = useState('')
  const tone: Tone = approval.status === 'approved' ? 'good' : approval.status === 'rejected' ? 'bad' : approval.status === 'pending' ? 'warn' : 'neutral'
  const decidable = canManage && approval.status === 'pending'
  return (
    <div className="rounded-xl border border-ink-100 bg-[#FAFCFD] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-ink-800">{humanize(approval.action)}</div>
          <div className="text-[10px] text-ink-400">
            {approval.status === 'pending'
              ? t('autonomy.waitingFor', { role: humanize(approval.requiredRole) })
              : approval.reason}
          </div>
        </div>
        <Pill tone={tone}>{humanize(approval.status)}</Pill>
      </div>
      {decidable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className={cn(fieldClass(), 'flex-1')} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('autonomy.note')} />
          <Button tone="success" onClick={() => runAction(decide(approval.id, 'approved', note.trim() || undefined))}>{t('autonomy.approve')}</Button>
          <Button tone="danger" onClick={() => runAction(decide(approval.id, 'rejected', note.trim() || undefined))}>{t('autonomy.reject')}</Button>
        </div>
      )}
    </div>
  )
}

function PlanSection({ plan }: { plan: ApiAutonomyPlan }) {
  const { t } = useI18n()
  return (
    <Section eyebrow="05" title={t('autonomy.plan')} hint={t('autonomy.planHint')}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-400">{t('autonomy.acceptanceCriteria')}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-ink-700">
        {plan.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}
      </ul>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-ink-400">{t('autonomy.requiredCapabilities')}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">{plan.requiredCapabilities.map((c) => <Pill key={c} tone="blue">{c}</Pill>)}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-ink-400">{t('autonomy.approvalNeeds')}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {plan.approvalNeeds.length === 0 ? <span className="text-[11px] text-ink-400">—</span> : plan.approvalNeeds.map((a) => <Pill key={a} tone="warn">{humanize(a)}</Pill>)}
          </div>
        </div>
      </div>
    </Section>
  )
}
