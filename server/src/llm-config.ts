/**
 * Runtime LLM configuration.
 *
 * Values in app_settings override the process environment and survive a
 * restart. Secrets are returned only to server-side callers; the admin API
 * exposes a boolean instead of the raw API key.
 */
import { pool } from './db/pool.js'
import { env } from './env.js'

export interface LlmRuntimeConfig {
  apiKey: string
  apiUrl: string
  model: string
  supportModel: string
  compactionModel: string
  imageModel: string
}

export interface PublicLlmRuntimeConfig {
  apiKeySet: boolean
  apiUrl: string
  model: string
  supportModel: string
  compactionModel: string
  imageModel: string
}

const SETTING_KEYS = {
  apiKey: 'llm_openai_api_key',
  apiUrl: 'llm_openai_api_url',
  model: 'llm_openai_model',
  supportModel: 'llm_openai_model_support',
  compactionModel: 'llm_openai_compaction_model',
  imageModel: 'llm_openai_image_model',
} as const

type Update = Partial<{ [K in keyof LlmRuntimeConfig]: string | null }>

const PROCESS_DEFAULTS: LlmRuntimeConfig = {
  apiKey: env.OPENAI_API_KEY,
  apiUrl: env.OPENAI_API_URL,
  model: env.OPENAI_MODEL,
  supportModel: env.OPENAI_MODEL_SUPPORT,
  compactionModel: env.OPENAI_COMPACTION_MODEL,
  imageModel: env.OPENAI_IMAGE_MODEL,
}

let cached: { at: number; value: LlmRuntimeConfig } | null = null
const CACHE_TTL_MS = 5_000

function envDefaults(): LlmRuntimeConfig {
  return { ...PROCESS_DEFAULTS }
}

function applyToEnv(config: LlmRuntimeConfig): void {
  // Existing callers read env.* directly. Updating the shared object keeps
  // runtime model changes effective without rewriting every agent call site.
  env.OPENAI_API_KEY = config.apiKey
  env.OPENAI_API_URL = config.apiUrl
  env.OPENAI_MODEL = config.model
  env.OPENAI_MODEL_SUPPORT = config.supportModel
  env.OPENAI_COMPACTION_MODEL = config.compactionModel
  env.OPENAI_IMAGE_MODEL = config.imageModel
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Load the effective config, applying DB overrides over env defaults. */
export async function loadLlmRuntimeConfig(force = false): Promise<LlmRuntimeConfig> {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value
  const defaults = envDefaults()
  const values = new Map<string, unknown>()
  try {
    const { rows } = await pool.query<{ key: string; value: unknown }>(
      'SELECT key, value FROM app_settings WHERE key = ANY($1::text[])',
      [Object.values(SETTING_KEYS)],
    )
    for (const row of rows) values.set(row.key, row.value)
  } catch (e) {
    // During early boot or a rolling migration, env-only operation is safer
    // than taking the whole server down because the settings table is absent.
    console.warn('[llm-config] DB read failed; using environment values', e instanceof Error ? e.message : e)
  }

  const pick = (key: string, fallback: string): string => valueAsString(values.get(key)) ?? fallback
  const config: LlmRuntimeConfig = {
    apiKey: pick(SETTING_KEYS.apiKey, defaults.apiKey),
    apiUrl: pick(SETTING_KEYS.apiUrl, defaults.apiUrl),
    model: pick(SETTING_KEYS.model, defaults.model),
    supportModel: pick(SETTING_KEYS.supportModel, defaults.supportModel),
    compactionModel: pick(SETTING_KEYS.compactionModel, defaults.compactionModel),
    imageModel: pick(SETTING_KEYS.imageModel, defaults.imageModel),
  }
  cached = { at: Date.now(), value: config }
  applyToEnv(config)
  return config
}

/** Persist only supplied fields. Empty/null values remove the DB override and
 *  restore the corresponding .env value. */
export async function updateLlmRuntimeConfig(updates: Update): Promise<LlmRuntimeConfig> {
  const allowed = new Set(Object.keys(SETTING_KEYS) as Array<keyof LlmRuntimeConfig>)
  for (const key of Object.keys(updates) as Array<keyof LlmRuntimeConfig>) {
    if (!allowed.has(key)) continue
    const value = updates[key]
    const settingKey = SETTING_KEYS[key]
    if (value == null || value.trim() === '') {
      await pool.query('DELETE FROM app_settings WHERE key = $1', [settingKey])
    } else {
      await pool.query(
        'INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ' +
        'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
        [settingKey, JSON.stringify(value.trim())],
      )
    }
  }
  cached = null
  return loadLlmRuntimeConfig(true)
}

export function toPublicLlmRuntimeConfig(config: LlmRuntimeConfig): PublicLlmRuntimeConfig {
  return {
    apiKeySet: Boolean(config.apiKey),
    apiUrl: config.apiUrl,
    model: config.model,
    supportModel: config.supportModel,
    compactionModel: config.compactionModel,
    imageModel: config.imageModel,
  }
}
