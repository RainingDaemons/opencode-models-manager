import { readFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

const CONFIG_FILE = path.join(".opencode", "models.json")

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isModelRef(value: string): boolean {
  const slash = value.indexOf("/")
  return slash > 0 && slash < value.length - 1
}

function loadModels(file: string): Record<string, string> | null {
  let raw: string
  try {
    raw = readFileSync(file, "utf8")
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.error(`[model-manager] could not parse ${file}: ${(error as Error).message}`)
    return null
  }

  if (!isRecord(parsed)) {
    console.error(`[model-manager] ${file} must contain a JSON object`)
    return null
  }

  const models: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed)) {
    if (name.trim() === "") {
      console.error(`[model-manager] ${file} contains an empty agent name`)
      continue
    }
    if (typeof value !== "string" || !isModelRef(value)) {
      console.error(
        `[model-manager] "${name}" must be "provider/model", got ${JSON.stringify(value)}`
      )
      continue
    }
    models[name] = value
  }

  return models
}

export default (async ({ directory, worktree }) => ({
  config: async (cfg) => {
    const root = worktree || directory
    const models = loadModels(path.join(root, CONFIG_FILE)) ??
      (root === directory ? null : loadModels(path.join(directory, CONFIG_FILE)))
    if (!models) return

    cfg.agent ??= {}
    for (const [name, model] of Object.entries(models)) {
      cfg.agent[name] = { ...cfg.agent[name], model }
    }
  },
})) satisfies Plugin
