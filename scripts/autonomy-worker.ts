import { runWorkerOnce, workerConfigFromEnv } from '../server/src/autonomy/worker.js'

const config = workerConfigFromEnv()
const once = process.argv.includes('--once')
const pollMs = Math.max(5_000, Number(process.env.CUMORA_AUTONOMY_POLL_MS || 15_000))

let running = true
while (running) {
  const worked = await runWorkerOnce(config)
  if (once) {
    running = false
    continue
  }
  if (!worked) await new Promise((resolve) => setTimeout(resolve, pollMs))
}
