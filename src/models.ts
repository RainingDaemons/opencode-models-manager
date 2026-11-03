import { readFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

const CONFIG_FILE = path.join(".opencode", "models.json")

type Section = "agent" | "command"
type Models = Record<Section, Record<string, string>>

const SECTIONS: Record<string, Section> = {
  agent: "agent",
  agents: "agent",
  command: "command",
  commands: "command",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isModelRef(value: string): boolean {
  const slash = value.indexOf("/")
  return slash > 0 && slash < value.length - 1
}

function isEntryName(name: string): boolean {
  return name.trim() !== ""
}

function loadSection(
  file: string,
  section: Section,
  value: Record<string, unknown>
): Record<string, string> {
  const models: Record<string, string> = {}
  for (const [name, model] of Object.entries(value)) {
    if (!isEntryName(name)) {
      console.error(`[model-manager] ${file} ${section}s contains an empty name`)
      continue
    }
    if (typeof model !== "string" || !isModelRef(model)) {
      console.error(
        `[model-manager] ${file} "${section}.${name}" must be "provider/model", got ${JSON.stringify(model)}`
      )
      continue
    }
    models[name] = model
  }
  return models
}

function loadModels(file: string): Models | null {
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

  const models: Models = { agent: {}, command: {} }
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      if (!isEntryName(key)) {
        console.error(`[model-manager] ${file} contains an empty agent name`)
        continue
      }
      if (!isModelRef(value)) {
        console.error(
          `[model-manager] ${file} "${key}" must be "provider/model", got ${JSON.stringify(value)}`
        )
        continue
      }
      models.agent[key] = value
      continue
    }

    const section = Object.hasOwn(SECTIONS, key) ? SECTIONS[key] : undefined
    if (!section) {
      console.error(`[model-manager] ${file} has unknown key "${key}"`)
      continue
    }
    if (!isRecord(value)) {
      console.error(`[model-manager] ${file} "${key}" must be a JSON object`)
      continue
    }
    Object.assign(models[section], loadSection(file, section, value))
  }

  return models
}

export default (async ({ directory, worktree }) => ({
  config: async (cfg) => {
    const root = worktree || directory
    const models = loadModels(path.join(root, CONFIG_FILE)) ??
      (root === directory ? null : loadModels(path.join(directory, CONFIG_FILE)))
    if (!models) return

    if (Object.keys(models.agent).length > 0) {
      cfg.agent ??= {}
      for (const [name, model] of Object.entries(models.agent)) {
        cfg.agent[name] = { ...cfg.agent[name], model }
      }
    }

    if (Object.keys(models.command).length > 0) {
      cfg.command ??= {}
      for (const [name, model] of Object.entries(models.command)) {
        const command = cfg.command[name]
        if (!command) {
          console.error(`[model-manager] command "${name}" was not found`)
          continue
        }
        cfg.command[name] = { ...command, model }
      }
    }
  },
})) satisfies Plugin
