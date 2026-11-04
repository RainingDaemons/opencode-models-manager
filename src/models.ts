import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

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

function parseModelRef(value: string): { providerID: string; id: string } {
  const separator = value.indexOf("/")
  return {
    providerID: value.slice(0, separator),
    id: value.slice(separator + 1),
  }
}

function configFileFor(ctx: any): string {
  // In v2 the server can be started from outside the project directory.
  // `location.directory` is the project root; keep the cwd fallback for
  // older v2 runtimes and for the local test harness.
  const directory =
    typeof ctx?.location?.directory === "string" ? ctx.location.directory : process.cwd()
  return path.join(directory, CONFIG_FILE)
}

function updateCommandFile(directory: string, name: string, model: string): boolean {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return false
  const file = path.join(directory, ".opencode", "commands", `${name}.md`)
  let source: string
  try {
    source = readFileSync(file, "utf8")
  } catch {
    return false
  }

  const frontmatter = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)/.exec(source)
  if (!frontmatter) return false
  const modelLine = `model: ${model}`
  const body = /^model:\s*.*$/m.test(frontmatter[2])
    ? frontmatter[2].replace(/^model:\s*.*$/m, modelLine)
    : `${frontmatter[2]}${frontmatter[2].endsWith("\n") ? "" : "\n"}${modelLine}`
  const updated = `${frontmatter[1]}${body}${frontmatter[3]}${source.slice(frontmatter[0].length)}`
  if (updated === source) return true
  writeFileSync(file, updated)
  return true
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
 * OpenCode v2 setup plugin.
 *
 * This intentionally has no package imports beyond Node built-ins: OpenCode
 * 2.0 resolves local and package plugins independently of its own SDK modules.
 */
export default {
  id: "opencode-models-manager",
  async setup(ctx: any) {
    const file = configFileFor(ctx)
    const models = loadModels(file)
    if (!models) return

    if (Object.keys(models.agent).length > 0) {
      await ctx.agent.transform((editor: any) => {
        for (const [name, model] of Object.entries(models.agent)) {
          editor.update(name, (agent: any) => {
            agent.model = parseModelRef(model)
          })
        }
      })
      await ctx.agent.reload()
    }

    if (
      Object.keys(models.command).length > 0 &&
      typeof ctx.command?.transform === "function" &&
      typeof ctx.session?.prompt === "function"
    ) {
      try {
        let existing: Record<string, any> = {}
        if (typeof ctx.command.list === "function") {
          const result = await ctx.command.list()
          const commands = Array.isArray(result) ? result : result?.data
          if (Array.isArray(commands)) {
            existing = Object.fromEntries(commands.map((command: any) => [command.name, command]))
          }
        }

        await ctx.command.transform((editor: any) => {
          if (typeof editor?.add !== "function") {
            console.error(
              `[model-manager] ${file} contains command models, but this OpenCode runtime cannot add command overrides`
            )
            return
          }
          for (const [name, model] of Object.entries(models.command)) {
            const command = existing[name]
            editor.add({
              name,
              description: command?.description,
              execute: async ({ sessionID, prompt, delivery }: any) => {
                await ctx.session.prompt({
                  ...prompt,
                  sessionID,
                  model: parseModelRef(model),
                  delivery,
                })
              },
            })
          }
        })
        if (typeof ctx.command.reload === "function") {
          await ctx.command.reload()
        } else {
          console.error(
            `[model-manager] ${file} registered command models, but this OpenCode runtime cannot reload commands`
          )
        }
      } catch (error) {
        console.error(`[model-manager] could not apply command models from ${file}: ${(error as Error).message}`)
      }
    } else if (Object.keys(models.command).length > 0) {
      console.error(
        `[model-manager] ${file} contains command models, but this OpenCode runtime does not support command overrides; those entries were skipped`
      )
    }

    // OpenCode 2.2's command transform is add-only and cannot replace a
    // command discovered from .opencode/commands. Persist the model in the
    // command's supported frontmatter instead, then refresh the catalog.
    if (Object.keys(models.command).length > 0) {
      const directory =
        typeof ctx?.location?.directory === "string" ? ctx.location.directory : process.cwd()
      let updated = 0
      for (const [name, model] of Object.entries(models.command)) {
        if (updateCommandFile(directory, name, model)) updated++
      }
      if (updated > 0 && typeof ctx.command?.reload === "function") {
        await ctx.command.reload()
      }
    }
  },
}
