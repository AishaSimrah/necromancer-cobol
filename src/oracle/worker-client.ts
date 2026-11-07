import type { Logger, OracleConfig } from "./config.js";
import { encodeFrame, FrameDecoder } from "./framing.js";
import type { WorkerMessage, WorkerRequest, WorkerResponse } from "./protocol.js";

export interface WorkerTransport {
  readonly stdin: { write(chunk: Buffer): boolean; end(): void };
  readonly stdout: AsyncIterable<Buffer>;
  readonly exited: Promise<{ code: number | null; signal: string | null }>;
  kill(): void;
}

export interface WorkerLauncher {
  /** Rejects with a message naming the missing component. */
  launch(cfg: OracleConfig): Promise<WorkerTransport>;
}

/** Thrown to every pending request when the Worker transport ends or breaks. */
export class WorkerLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerLostError";
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type WorkerRequestBody = DistributiveOmit<WorkerRequest, "id">;

interface Pending {
  resolve(response: WorkerResponse): void;
  reject(error: Error): void;
}

interface Session {
  readonly transport: WorkerTransport;
  readonly pending: Map<string, Pending>;
  lost: WorkerLostError | null;
}

const STOP_GRACE_MS = 2000;

const REQUEST_TYPES: ReadonlySet<string> = new Set([
  "ping",
  "compile",
  "run",
  "release",
  "shutdown",
]);

function isResponse(message: WorkerMessage): message is WorkerResponse {
  return typeof message.id === "string" && !REQUEST_TYPES.has(message.type);
}

export class WorkerClient {
  private session: Session | null = null;
  private starting: Promise<Session> | null = null;
  private nextId = 1;

  constructor(
    private readonly launcher: WorkerLauncher,
    private readonly cfg: OracleConfig,
    private readonly logger: Logger,
  ) {}

  /** Assigns the id, launches the Worker lazily and resolves with the matching response. */
  async request(req: WorkerRequestBody): Promise<WorkerResponse> {
    const session = await this.ensureStarted();
    return this.send(session, req);
  }

  async stop(): Promise<void> {
    if (this.starting !== null) {
      try {
        await this.starting;
      } catch {
        // launch failed; nothing to stop
      }
    }
    const session = this.session;
    if (session === null) return;
    if (session.lost === null) {
      try {
        await this.withTimeout(this.send(session, { type: "shutdown" }), STOP_GRACE_MS);
      } catch {
        // fall through to forced teardown
      }
    }
    this.teardown(session, new WorkerLostError("worker stopped"));
    await session.transport.exited.catch(() => undefined);
  }

  private ensureStarted(): Promise<Session> {
    if (this.session !== null && this.session.lost === null) {
      return Promise.resolve(this.session);
    }
    if (this.starting === null) {
      const attempt = this.start().finally(() => {
        if (this.starting === attempt) this.starting = null;
      });
      this.starting = attempt;
    }
    return this.starting;
  }

  private async start(): Promise<Session> {
    const transport = await this.launcher.launch(this.cfg);
    const session: Session = { transport, pending: new Map(), lost: null };
    void this.readLoop(session);
    void transport.exited.then(
      (info) =>
        this.teardown(
          session,
          new WorkerLostError(
            `worker exited (code ${String(info.code)}, signal ${String(info.signal)})`,
          ),
        ),
      (err: unknown) =>
        this.teardown(session, new WorkerLostError(`worker failed: ${describe(err)}`)),
    );
    try {
      const pong = await this.send(session, { type: "ping" });
      if (pong.type !== "pong") {
        throw new WorkerLostError(`unexpected handshake response: ${pong.type}`);
      }
    } catch (err) {
      this.teardown(session, new WorkerLostError(`worker handshake failed: ${describe(err)}`));
      throw err;
    }
    this.session = session;
    return session;
  }

  private send(session: Session, body: WorkerRequestBody): Promise<WorkerResponse> {
    if (session.lost !== null) return Promise.reject(session.lost);
    const id = `r${this.nextId++}`;
    const message = { ...body, id } as WorkerRequest;
    return new Promise<WorkerResponse>((resolve, reject) => {
      session.pending.set(id, { resolve, reject });
      try {
        session.transport.stdin.write(encodeFrame(message));
      } catch (err) {
        session.pending.delete(id);
        const lost = new WorkerLostError(`write to worker failed: ${describe(err)}`);
        this.teardown(session, lost);
        reject(lost);
      }
    });
  }

  private async readLoop(session: Session): Promise<void> {
    const decoder = new FrameDecoder();
    try {
      for await (const chunk of session.transport.stdout) {
        for (const message of decoder.push(chunk)) {
          if (!isResponse(message)) {
            throw new WorkerLostError("protocol error: worker sent a request frame");
          }
          const entry = session.pending.get(message.id);
          if (entry === undefined) {
            this.logger.warn("worker response with unknown id", { id: message.id });
            continue;
          }
          session.pending.delete(message.id);
          entry.resolve(message);
        }
      }
      this.teardown(session, new WorkerLostError("worker closed its output (EOF)"));
    } catch (err) {
      this.teardown(
        session,
        err instanceof WorkerLostError
          ? err
          : new WorkerLostError(`protocol error: ${describe(err)}`),
      );
    }
  }

  /** Marks the session lost, rejects every pending request and kills the transport. */
  private teardown(session: Session, error: WorkerLostError): void {
    if (session.lost !== null) return;
    session.lost = error;
    if (this.session === session) this.session = null;
    const entries = [...session.pending.values()];
    session.pending.clear();
    for (const entry of entries) entry.reject(error);
    try {
      session.transport.stdin.end();
    } catch {
      // already closed
    }
    try {
      session.transport.kill();
    } catch {
      // already gone
    }
    this.logger.debug("worker session ended", { reason: error.message });
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out")), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
