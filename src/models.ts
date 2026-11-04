import { readFileSync } from "node:fs"
import path from "node:path"
import { Model, Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"

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

export function loadModels(file: string): Models | null {
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

/**
 * OpenCode v2 effect plugin.
 *
 * The v2 command API can only add commands; it cannot amend commands loaded
 * from configuration. Agent models remain fully supported through its agent
 * transform API.
 */
export default Plugin.define({
  id: "opencode-models-manager",
  effect: (ctx) =>
    Effect.gen(function* () {
      const file = path.join(ctx.location.directory, CONFIG_FILE)
      const models = loadModels(file)
      if (!models) return

      if (Object.keys(models.agent).length > 0) {
        yield* ctx.agent.transform((editor) => {
          for (const [name, model] of Object.entries(models.agent)) {
            editor.update(name, (agent) => {
              agent.model = Model.Ref.parse(model)
            })
          }
        })
        yield* ctx.agent.reload()
      }

      if (Object.keys(models.command).length > 0) {
        console.error(
          `[model-manager] ${file} contains command models, but OpenCode v2 does not support updating existing command definitions; those entries were skipped`
        )
      }
    }),
})
