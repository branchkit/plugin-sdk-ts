import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";

interface RpcMessage {
  jsonrpc: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: RpcError;
}

interface RpcError {
  code: number;
  message: string;
}

export interface ActionResponse {
  status?: string;
  control_message?: string;
  result?: unknown;
}

export class SimulateResult {
  matched!: boolean;
  action?: unknown;
  args?: unknown[];
  consumed_count?: number;
  sets_tags?: string[];
  clears_tags?: string[];
  owner_plugin?: string;
  action_response?: ActionResponse;

  actionType(): string {
    if (!this.action || typeof this.action !== "object") return "";
    return (this.action as Record<string, unknown>).action_type as string ?? "";
  }

  actionParams<T = unknown>(): T {
    if (!this.action || typeof this.action !== "object") {
      throw new Error("no action in result");
    }
    return (this.action as Record<string, unknown>).params as T;
  }
}

export interface CollectionResult {
  name: string;
  introducer: string;
  contributions: Record<string, unknown>;
}

export interface PluginState {
  alive: boolean;
  plugin_id: string;
  rpc_call_count: number;
  rpc_error_count: number;
  rpc_methods_seen: string[];
}

export interface HUDResult {
  channel: string;
  html: string;
  target_id?: string;
  raw?: boolean;
}

export interface HUDChannelInfo {
  channel: string;
  plugin_id: string;
  description: string;
}

export interface RpcLogEntry {
  method: string;
  params: unknown;
  ok: boolean;
  stubbed: boolean;
}

export interface ConformanceTest {
  name: string;
  status: string;
  detail?: string;
}

export interface ConformancePhase {
  phase: string;
  tests: ConformanceTest[];
}

export interface ConformanceResult {
  phases: ConformancePhase[];
}

export interface DepStatus {
  plugin: string;
  status: "resolved" | "missing";
  version?: string;
  source?: string;
  reason?: string;
}

export class HarnessError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = "HarnessError";
  }
}

export class Harness {
  private proc: ChildProcess;
  private rl: Interface;
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  private constructor(proc: ChildProcess, rl: Interface) {
    this.proc = proc;
    this.rl = rl;

    this.rl.on("line", (line: string) => {
      if (line.length === 0) return;
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) {
            p.reject(new HarnessError(msg.error.code, msg.error.message));
          } else {
            p.resolve(msg.result);
          }
        }
      }
    });
  }

  static async start(dir: string): Promise<Harness> {
    const binary = findHarnessBinary();
    const absDir = resolve(dir);

    const proc = spawn(binary, ["--server"], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    const rl = createInterface({
      input: proc.stdout!,
      crlfDelay: Infinity,
    });

    const h = new Harness(proc, rl);

    await h.call<{ plugin_id: string }>("test.start", { dir: absDir });
    return h;
  }

  async stop(): Promise<void> {
    await this.call("test.stop", {});
    this.cleanup();
  }

  async reset(): Promise<void> {
    await this.call("test.reset", {});
  }

  async reload(): Promise<void> {
    await this.call("test.reload", {});
  }

  /**
   * Load a dependency plugin's manifest without spawning its binary.
   * Accepts a local directory path or a plugin name (resolved via
   * installed plugins, then the catalog).
   */
  async loadManifest(dirOrName: string): Promise<void> {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const absDir = path.resolve(dirOrName);
    if (fs.existsSync(path.join(absDir, "plugin.json"))) {
      await this.call("test.load_manifest", { dir: absDir });
    } else {
      await this.call("test.load_manifest", { name: dirOrName });
    }
  }

  /**
   * Resolve all depends_on entries for the running plugin and report status.
   */
  async resolveDeps(): Promise<DepStatus[]> {
    const result = await this.call<{ deps: DepStatus[] }>("test.resolve_deps", {});
    return result.deps;
  }

  async setTag(tag: string): Promise<void> {
    await this.call("test.set_tag", { tag });
  }

  async clearTag(tag: string): Promise<void> {
    await this.call("test.clear_tag", { tag });
  }

  async getTags(pattern: string): Promise<string[]> {
    const result = await this.call<{ tags: string[] }>("test.get_tags", {
      pattern,
    });
    return result.tags;
  }

  async simulateCommand(phrase: string): Promise<SimulateResult> {
    const data = await this.call<SimulateResult>("test.simulate_command", { phrase });
    return Object.assign(new SimulateResult(), data);
  }

  async mustSimulateCommand(phrase: string): Promise<SimulateResult> {
    const result = await this.simulateCommand(phrase);
    if (!result.matched) {
      throw new Error(`expected "${phrase}" to match a command, but it didn't`);
    }
    return result;
  }

  async getCollection(name: string): Promise<CollectionResult> {
    return this.call<CollectionResult>("test.get_collection", { name });
  }

  async writeCollection(
    name: string,
    data: unknown,
    contributor?: string,
  ): Promise<void> {
    const params: Record<string, unknown> = { name, data };
    if (contributor) params.contributor = contributor;
    await this.call("test.write_collection", params);
  }

  async callPlugin(
    method: string,
    params: unknown,
  ): Promise<unknown> {
    return this.call("test.call_plugin_method", { method, params });
  }

  async getPluginState(): Promise<PluginState> {
    return this.call<PluginState>("test.get_plugin_state", {});
  }

  async setWorld(world: unknown): Promise<void> {
    await this.call("test.set_world", world);
  }

  async requireTag(tag: string): Promise<void> {
    const tags = await this.getTags(tag);
    if (!tags.includes(tag)) {
      throw new Error(`expected tag "${tag}" to be active, but it was not`);
    }
  }

  async requireNoTag(tag: string): Promise<void> {
    const tags = await this.getTags(tag);
    if (tags.includes(tag)) {
      throw new Error(
        `expected tag "${tag}" to NOT be active, but it was`,
      );
    }
  }

  async injectEvent(eventType: string, data: unknown): Promise<void> {
    await this.call("test.inject_event", { event_type: eventType, data });
  }

  async getHUD(channel: string): Promise<HUDResult> {
    return this.call<HUDResult>("test.get_hud", { channel });
  }

  async listHUDChannels(): Promise<HUDChannelInfo[]> {
    const result = await this.call<{ channels: HUDChannelInfo[] }>(
      "test.get_hud",
      {},
    );
    return result.channels;
  }

  async getRpcLog(): Promise<RpcLogEntry[]> {
    const result = await this.call<{ entries: RpcLogEntry[] }>(
      "test.get_rpc_log",
      {},
    );
    return result.entries;
  }

  async runStaticAnalysis(): Promise<ConformancePhase> {
    return this.call<ConformancePhase>("test.run_static_analysis", {});
  }

  async runStartupCheck(): Promise<ConformancePhase> {
    return this.call<ConformancePhase>("test.run_startup_check", {});
  }

  async runRPCContract(): Promise<ConformancePhase> {
    return this.call<ConformancePhase>("test.run_rpc_contract", {});
  }

  async runSettingsCheck(): Promise<ConformancePhase> {
    return this.call<ConformancePhase>("test.run_settings_check", {});
  }

  async runDependencyCheck(): Promise<ConformancePhase> {
    return this.call<ConformancePhase>("test.run_dependency_check", {});
  }

  async runAll(): Promise<ConformanceResult> {
    return this.call<ConformanceResult>("test.run_all", {});
  }

  private call<T = unknown>(method: string, params: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HarnessError(-32000, `timeout: ${method} did not respond within 30s`));
      }, 30_000);

      this.pending.set(id, {
        resolve: (v: unknown) => { clearTimeout(timer); (resolve as (v: unknown) => void)(v); },
        reject: (e: Error) => { clearTimeout(timer); reject(e); },
      });

      const msg = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });

      this.proc.stdin!.write(msg + "\n");
    });
  }

  private cleanup(): void {
    this.rl.close();
    this.proc.stdin!.end();
    this.proc.kill();
    for (const [, p] of this.pending) {
      p.reject(new Error("harness closed"));
    }
    this.pending.clear();
  }

  [Symbol.dispose](): void {
    this.cleanup();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}

function findHarnessBinary(): string {
  const env = process.env.BRANCHKIT_TEST_HARNESS;
  if (env) return env;

  const candidates = [
    "target/debug/branchkit-test-harness",
    "target/release/branchkit-test-harness",
    "../target/debug/branchkit-test-harness",
    "../target/release/branchkit-test-harness",
    "../../target/debug/branchkit-test-harness",
    "../../target/release/branchkit-test-harness",
  ];

  for (const c of candidates) {
    const abs = resolve(c);
    if (existsSync(abs)) return abs;
  }

  // Try PATH via which
  try {
    return execSync("which branchkit-test-harness", { encoding: "utf8" }).trim();
  } catch {
    // fall through
  }

  throw new Error(
    "harness: cannot find branchkit-test-harness binary. " +
      "Set BRANCHKIT_TEST_HARNESS or run 'cargo build -p branchkit-test-harness'",
  );
}
