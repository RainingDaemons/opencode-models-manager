import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"
import plugin from "../src/models.ts"

type Config = {
  agent?: Record<string, { model?: string; [key: string]: unknown }>
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
  const dir = mkdtempSync(path.join(root, "dir-"))
  return dir
}

async function runConfig(directory: string, worktree?: string, cfg: Config = {}): Promise<Config> {
  const hooks = await plugin({ directory, worktree } as never)
  await hooks.config(cfg as never)
  return cfg
}

describe("models plugin", () => {
  it("applies valid models from the worktree config", async () => {
    writeModels(root, {
      chat: "opencode-go/deepseek-v4.1-flash",
      chat2: "opencode-go/mimo-v2.6-flash",
    })

    const cfg = await runConfig(root, root)

    assert.deepEqual(cfg.agent, {
      chat: { model: "opencode-go/deepseek-v4.1-flash" },
      chat2: { model: "opencode-go/mimo-v2.6-flash" },
    })
  })

  it("merges the model into existing agent configuration", async () => {
    writeModels(root, { chat: "provider/model" })
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

  it("falls back to the directory config when the worktree has none", async () => {
    const directory = makeDir()
    const worktree = makeDir()
    writeModels(directory, { chat: "directory/model" })

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
    })

    const cfg = await runConfig(root, root)

    assert.deepEqual(cfg.agent, {
      valid: { model: "provider/model" },
      multiSlash: { model: "provider/family/model" },
    })
    assert.equal(errors.length, 8)
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

  it("returns an untouched config for an empty models object", async () => {
    writeModels(root, {})

    const cfg = await runConfig(root, root)

    assert.deepEqual(cfg.agent, {})
    assert.deepEqual(errors, [])
  })
})
