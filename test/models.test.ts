import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

function writeCommand(name: string, contents: string): void {
  const file = path.join(root, ".opencode", "commands", `${name}.md`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, contents)
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

type Command = { model?: { id: string; providerID: string }; template?: string }

async function runPluginWithV2Lifecycle(
  agents: Record<string, Agent>,
  commands: Record<string, Command> = {}
): Promise<void> {
  const previousDirectory = process.cwd()
  let transform: ((editor: { update: (id: string, update: (agent: Agent) => void) => void }) => void) | undefined
  const context = {
    location: { directory: root },
    agent: {
      transform: (callback: typeof transform) => {
        transform = callback
        return Promise.resolve({ dispose: () => Promise.resolve() })
      },
      reload: () => {
        transform?.({ update: (id, update) => agents[id] && update(agents[id]) })
        return Promise.resolve()
      },
    },
    command: {
      transform: (callback: typeof transform) => {
        transform = callback
        return Promise.resolve({ dispose: () => Promise.resolve() })
      },
      reload: () => {
        transform?.({ update: (id, update) => commands[id] && update(commands[id]) })
        return Promise.resolve()
      },
    },
  }
  process.chdir(tmpdir())
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

  it("applies every configured mode through the v2 register-then-reload lifecycle", async () => {
    writeModels({
      agent: {
        review: "opencode-go/deepseek-v4.1-flash",
        test: "opencode-go/qwen3.8-flash",
      },
    })
    const agents = { review: {}, test: {} }

    await runPluginWithV2Lifecycle(agents)

    assert.deepEqual(agents, {
      review: { model: { id: "deepseek-v4.1-flash", providerID: "opencode-go" } },
      test: { model: { id: "qwen3.8-flash", providerID: "opencode-go" } },
    })
  })

  it("supports the legacy flat agent configuration", async () => {
    writeModels({ chat: "provider/model" })
    const agents: Record<string, Agent> = { chat: {} }

    await runPlugin(agents)

    assert.deepEqual(agents.chat.model, { id: "model", providerID: "provider" })
  })

  it("overrides command execution with the configured model", async () => {
    writeModels({ commands: { document2: "provider/mimo-v2.6-flash" } })
    const added: Record<string, any> = {}
    let prompted: any
    const previousDirectory = process.cwd()
    const context = {
      location: { directory: root },
      command: {
        list: () => Promise.resolve({ data: [{ name: "document2", template: "Fix broken tests" }] }),
        transform: (callback: any) => Promise.resolve(callback({ add: (command: any) => { added[command.name] = command } })),
        reload: async () => added.document2.execute({ sessionID: "session", prompt: { text: "Fix broken tests" }, delivery: "steer" }),
      },
      session: { prompt: (input: any) => { prompted = input; return Promise.resolve() } },
    }
    process.chdir(tmpdir())
    try {
      await plugin.setup(context)
    } finally {
      process.chdir(previousDirectory)
    }

    assert.deepEqual(prompted, {
      text: "Fix broken tests",
      sessionID: "session",
      model: { id: "mimo-v2.6-flash", providerID: "provider" },
      delivery: "steer",
    })
    assert.deepEqual(errors, [])
  })

  it("reports command mappings when the runtime has no command transform API", async () => {
    writeModels({ commands: { document: "provider/model" } })

    await runPlugin({})

    assert.equal(errors.length, 1)
    assert.match(errors[0], /does not support command overrides/)
  })

  it("keeps agent models working when command overrides are unavailable", async () => {
    writeModels({
      agent: { chat2: "provider/mimo" },
      commands: { document2: "provider/mimo" },
    })
    const agents: Record<string, Agent> = { chat2: {} }
    const previousDirectory = process.cwd()
    const context = {
      location: { directory: root },
      agent: {
        transform: (callback: any) => Promise.resolve(callback({ update: (id: string, update: any) => agents[id] && update(agents[id]) })),
        reload: () => Promise.resolve(),
      },
      command: {
        transform: () => Promise.reject(new Error("unsupported")),
      },
    }
    process.chdir(tmpdir())
    try {
      await plugin.setup(context)
    } finally {
      process.chdir(previousDirectory)
    }

    assert.deepEqual(agents.chat2, { model: { id: "mimo", providerID: "provider" } })
    assert.match(errors[0], /does not support command overrides/)
  })

  it("writes command models to file-backed command frontmatter", async () => {
    writeModels({ commands: { document2: "provider/mimo-v2.6-flash" } })
    writeCommand("document2", "---\ndescription: Docs\n---\nFix broken tests\n")
    const previousDirectory = process.cwd()
    const context = {
      location: { directory: root },
      command: { reload: () => Promise.resolve() },
    }
    process.chdir(tmpdir())
    try {
      await plugin.setup(context)
    } finally {
      process.chdir(previousDirectory)
    }

    assert.match(readFileSync(path.join(root, ".opencode", "commands", "document2.md"), "utf8"), /model: provider\/mimo-v2\.6-flash/)
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
