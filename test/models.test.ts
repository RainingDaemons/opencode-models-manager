import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"
import plugin from "../src/models.ts"

type CommandConfig = {
  template?: string
  description?: string
  agent?: string
  model?: string
  [key: string]: unknown
}

type Config = {
  agent?: Record<string, { model?: string; [key: string]: unknown }>
  command?: Record<string, CommandConfig>
}

let root: string
let errors: string[]
const originalConsoleError = console.error

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "models-manager-"))
  errors = []
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "))
  }
})

afterEach(() => {
  console.error = originalConsoleError
  rmSync(root, { recursive: true, force: true })
})

function writeModels(dir: string, contents: unknown): void {
  const file = path.join(dir, ".opencode", "models.json")
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents))
}

function makeDir(): string {
  return mkdtempSync(path.join(root, "dir-"))
}

async function runConfig(directory: string, worktree?: string, cfg: Config = {}): Promise<Config> {
  const hooks = await plugin({ directory, worktree } as never)
  await hooks.config(cfg as never)
  return cfg
}

describe("models plugin", () => {
  it("applies agent and command models from the worktree config", async () => {
    writeModels(root, {
      agent: {
        chat: "opencode-go/deepseek-v4.1-flash",
        chat2: "opencode-go/mimo-v2.6-flash",
      },
      commands: {
        document: "opencode-go/deepseek-v4.1-flash",
      },
    })
    const cfg: Config = {
      command: {
        document: {
          template: "Generate docs",
          description: "Generate documentation",
          agent: "build",
          model: "old/model",
        },
      },
    }

    await runConfig(root, root, cfg)

    assert.deepEqual(cfg.agent, {
      chat: { model: "opencode-go/deepseek-v4.1-flash" },
      chat2: { model: "opencode-go/mimo-v2.6-flash" },
    })
    assert.deepEqual(cfg.command?.document, {
      template: "Generate docs",
      description: "Generate documentation",
      agent: "build",
      model: "opencode-go/deepseek-v4.1-flash",
    })
    assert.deepEqual(errors, [])
  })

  it("accepts singular and plural section names", async () => {
    writeModels(root, {
      agents: { chat: "provider/agent-model" },
      command: { document: "provider/command-model" },
    })
    const cfg: Config = {
      command: { document: { template: "Docs", model: "old/model" } },
    }

    await runConfig(root, root, cfg)

    assert.deepEqual(cfg.agent, { chat: { model: "provider/agent-model" } })
    assert.equal(cfg.command?.document.model, "provider/command-model")
  })

  it("merges the model into existing agent configuration", async () => {
    writeModels(root, { agent: { chat: "provider/model" } })
    const cfg: Config = {
      agent: { chat: { model: "old/model", prompt: "keep me", temperature: 0.3 } },
    }

    await runConfig(root, root, cfg)

    assert.deepEqual(cfg.agent?.chat, {
      model: "provider/model",
      prompt: "keep me",
      temperature: 0.3,
    })
  })

  it("skips models for commands that are not defined", async () => {
    writeModels(root, { commands: { missing: "provider/model" } })

    const cfg = await runConfig(root, root)

    assert.equal(cfg.agent, undefined)
    assert.deepEqual(cfg.command, {})
    assert.equal(errors.length, 1)
    assert.match(errors[0], /command "missing" was not found/)
  })

  it("supports the legacy flat agent configuration", async () => {
    writeModels(root, { chat: "provider/model" })

    const cfg = await runConfig(root, root)

    assert.deepEqual(cfg.agent, { chat: { model: "provider/model" } })
    assert.equal(cfg.command, undefined)
    assert.deepEqual(errors, [])
  })

  it("falls back to the directory config when the worktree has none", async () => {
    const directory = makeDir()
    const worktree = makeDir()
    writeModels(directory, { agent: { chat: "directory/model" } })

    const cfg = await runConfig(directory, worktree)

    assert.deepEqual(cfg.agent, { chat: { model: "directory/model" } })
  })

  it("does not fall back when the worktree is the directory", async () => {
    const directory = makeDir()

    const cfg = await runConfig(directory, directory)

    assert.equal(cfg.agent, undefined)
    assert.deepEqual(errors, [])
  })

  it("does nothing when no config file exists", async () => {
    const cfg = await runConfig(makeDir())

    assert.deepEqual(cfg, {})
    assert.deepEqual(errors, [])
  })

  it("skips invalid agent names and model references", async () => {
    writeModels(root, {
      agent: {
        valid: "provider/model",
        multiSlash: "provider/family/model",
        noSlash: "model",
        emptyProvider: "/model",
        emptyModel: "model/",
        wrongType: 42,
        nullValue: null,
        arrayValue: ["provider/model"],
        "": "provider/model",
        "   ": "provider/model",
      },
      commands: {
        good: "provider/model",
        bad: "nope",
      },
      extra: { thing: "provider/model" },
    })
    const cfg: Config = {
      command: { good: { template: "Good", model: "old/model" } },
    }

    await runConfig(root, root, cfg)

    assert.deepEqual(cfg.agent, {
      valid: { model: "provider/model" },
      multiSlash: { model: "provider/family/model" },
    })
    assert.equal(cfg.command?.good.model, "provider/model")
    assert.equal(errors.length, 10)
  })

  it("ignores a config file with invalid JSON", async () => {
    writeModels(root, "{ not json")

    const cfg = await runConfig(root, root)

    assert.equal(cfg.agent, undefined)
    assert.equal(errors.length, 1)
    assert.match(errors[0], /could not parse/)
  })

  it("ignores a config file that is not a JSON object", async () => {
    writeModels(root, ["provider/model"])

    const cfg = await runConfig(root, root)

    assert.equal(cfg.agent, undefined)
    assert.equal(errors.length, 1)
    assert.match(errors[0], /must contain a JSON object/)
  })

  it("ignores sections that are not JSON objects", async () => {
    writeModels(root, { agent: 42, commands: null })

    const cfg = await runConfig(root, root)

    assert.equal(cfg.agent, undefined)
    assert.equal(cfg.command, undefined)
    assert.equal(errors.length, 2)
    assert.match(errors[0], /"agent" must be a JSON object/)
    assert.match(errors[1], /"commands" must be a JSON object/)
  })

  it("returns an untouched config for an empty models object", async () => {
    writeModels(root, {})

    const cfg = await runConfig(root, root)

    assert.deepEqual(cfg, {})
    assert.deepEqual(errors, [])
  })
})
