import { createHmac, timingSafeEqual } from 'node:crypto'
import express, { type Request, Router } from 'express'
import { recordMergedBranch } from '../autonomy/coordinator.js'

interface RawRequest extends Request {
  rawBody?: Buffer
}

function validSignature(body: Buffer, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  const left = Buffer.from(expected)
  const right = Buffer.from(signature)
  return left.length === right.length && timingSafeEqual(left, right)
}

export const _testing = { validSignature }

export const autonomyGithubWebhook: Router = Router()

autonomyGithubWebhook.use(express.json({
  limit: '2mb',
  verify: (req, _res, buffer) => { (req as RawRequest).rawBody = Buffer.from(buffer) },
}))

autonomyGithubWebhook.post('/', async (req: RawRequest, res) => {
  const secret = process.env.CUMORA_GITHUB_WEBHOOK_SECRET?.trim()
  if (!secret) { res.status(503).json({ error: 'GitHub autonomy webhook is not configured' }); return }
  const signature = String(req.headers['x-hub-signature-256'] ?? '')
  if (!req.rawBody || !validSignature(req.rawBody, signature, secret)) {
    res.status(401).json({ error: 'invalid webhook signature' })
    return
  }
  if (req.headers['x-github-event'] !== 'pull_request') {
    res.status(202).json({ ignored: true })
    return
  }
  const payload = req.body as {
    action?: string
    pull_request?: {
      merged?: boolean
      html_url?: string
      merge_commit_sha?: string
      head?: { ref?: string }
    }
    repository?: { ssh_url?: string }
  }
  if (payload.action !== 'closed' || payload.pull_request?.merged !== true) {
    res.status(202).json({ ignored: true })
    return
  }
  const branch = payload.pull_request.head?.ref
  const commitSha = payload.pull_request.merge_commit_sha
  const repositoryUrl = payload.repository?.ssh_url
  if (!branch || !commitSha || !repositoryUrl) {
    res.status(400).json({ error: 'merged pull request payload is incomplete' })
    return
  }
  try {
    const result = await recordMergedBranch({
      repositoryUrl,
      branch,
      commitSha,
      pullRequestUrl: payload.pull_request.html_url,
    })
    res.status(result ? 202 : 200).json(result ?? { ignored: true, reason: 'no approved autonomous work item matched' })
  } catch (error) {
    console.error('[autonomy] GitHub merge webhook failed', error)
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})
