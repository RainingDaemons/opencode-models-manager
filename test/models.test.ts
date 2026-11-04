import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"
import plugin, { loadModels } from "../src/models.ts"

type Agent = { model?: { id: string; providerID: string }; prompt?: string }

let root: string
let errors: string[]
const originalConsoleError = console.error

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "models-manager-"))
  errors = []
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "))
})

afterEach(() => {
  console.error = originalConsoleError
  rmSync(root, { recursive: true, force: true })
})

function writeModels(contents: unknown): void {
  const file = path.join(root, ".opencode", "models.json")
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents))
}

async function runPlugin(agents: Record<string, Agent>): Promise<void> {
  const previousDirectory = process.cwd()
  const context = {
    agent: {
      transform: (transform: (editor: { update: (id: string, update: (agent: Agent) => void) => void }) => void) =>
        Promise.resolve(transform({ update: (id, update) => agents[id] && update(agents[id]) })),
      reload: () => Promise.resolve(),
    },
  }
  process.chdir(root)
  try {
    await plugin.setup(context)
  } finally {
    process.chdir(previousDirectory)
  }
}

describe("OpenCode v2 models plugin", () => {
  it("exports the v2 plugin definition required by the server loader", () => {
    assert.equal(plugin.id, "opencode-models-manager")
    assert.equal(typeof plugin.setup, "function")
  })

  it("updates an existing agent while preserving its other settings", async () => {
    writeModels({ agent: { chat: "opencode-go/deepseek-v4.1-flash" } })
    const agents = { chat: { model: { id: "old", providerID: "old" }, prompt: "keep me" } }

    await runPlugin(agents)

    assert.deepEqual(agents.chat, {
      model: { id: "deepseek-v4.1-flash", providerID: "opencode-go" },
      prompt: "keep me",
    })
    assert.deepEqual(errors, [])
  })

  it("supports the legacy flat agent configuration", async () => {
    writeModels({ chat: "provider/model" })
    const agents: Record<string, Agent> = { chat: {} }

    await runPlugin(agents)

    assert.deepEqual(agents.chat.model, { id: "model", providerID: "provider" })
  })

  it("logs and skips command models because OpenCode v2 cannot update commands", async () => {
    writeModels({ commands: { document: "provider/model" } })

    await runPlugin({})

    assert.equal(errors.length, 1)
    assert.match(errors[0], /does not support updating existing command definitions/)
  })

  it("rejects invalid entries while keeping valid ones", () => {
    writeModels({ agent: { valid: "provider/model", invalid: "model", "": "provider/model" } })

    assert.deepEqual(loadModels(path.join(root, ".opencode", "models.json")), {
      agent: { valid: "provider/model" },
      command: {},
    })
    assert.equal(errors.length, 2)
  })
})
