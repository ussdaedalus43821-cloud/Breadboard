// The sim worker's logic, free of worker globals so tests can drive it over a
// MessageChannel. Owns the ONE authoritative Circuit and its Simulation
// (docs/ARCHITECTURE.md §3). Time only moves when told to: by step/run
// requests, or by advance() from the real-time clock that serveSim installs.

import { benchCircuit, emptyCircuit, type Circuit } from '../domain/circuit/circuit';
import { applyCommand, type Command } from '../domain/circuit/commands';
import { Simulation } from '../domain/sim/engine';
import {
  MAX_RUN_MS,
  MAX_STEP_TICKS,
  type PortLike,
  type SimErrorCode,
  type SimMessage,
  type SimRequest,
  type SimResponse,
} from '../protocol/sim-protocol';

/** Real-time catch-up is capped so a backgrounded tab does not replay minutes of ticks. */
const MAX_CATCH_UP_TICKS = 250;
/** Minimum wall-clock gap between `time` pushes when nothing else changed. */
const TIME_PUSH_MS = 100;

export class SimService {
  private circuit: Circuit = benchCircuit();
  private sim = new Simulation(this.circuit);
  private revision = 0;
  private running = false;
  private owedMs = 0;
  private sinceTimePush = 0;

  /** Handle one request; returns the messages to send, pushes first. */
  handle(raw: unknown): SimMessage[] {
    const req = raw as Partial<SimRequest> | null;
    const id = typeof req?.id === 'number' ? req.id : -1;
    try {
      if (!req || req.v !== 1) {
        return [this.fail(id, 'BAD_REQUEST', 'missing or unsupported protocol version')];
      }
      switch (req.kind) {
        case 'hello': {
          const options = req.splitRails === undefined ? {} : { splitRails: req.splitRails };
          this.circuit =
            req.preset === 'empty'
              ? emptyCircuit(req.size, options)
              : benchCircuit(req.size, options);
          this.sim = new Simulation(this.circuit);
          this.owedMs = 0;
          return [...this.publish(true), this.ok(id, {})];
        }
        case 'command': {
          const result = applyCommand(this.circuit, req.cmd as Command);
          if (!result.ok) return [this.fail(id, result.error.code, result.error.message)];
          this.circuit = result.circuit;
          this.sim.load(this.circuit);
          return [...this.publish(true), this.ok(id, { id: result.id })];
        }
        case 'step': {
          const n = req.ticks;
          if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
            return [
              this.fail(
                id,
                'BAD_ARGS',
                `step needs a whole number of ticks ≥ 1, got ${JSON.stringify(n)}`,
              ),
            ];
          }
          if (n > MAX_STEP_TICKS) {
            return [this.fail(id, 'LIMIT', `step is capped at ${MAX_STEP_TICKS} ticks per call`)];
          }
          return this.advanceBy(id, n);
        }
        case 'run': {
          const ms = req.ms;
          if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
            return [
              this.fail(id, 'BAD_ARGS', `run needs a time in ms > 0, got ${JSON.stringify(ms)}`),
            ];
          }
          if (ms > MAX_RUN_MS) {
            return [this.fail(id, 'LIMIT', `run is capped at ${MAX_RUN_MS} ms per call`)];
          }
          return this.advanceBy(id, Math.ceil(ms));
        }
        case 'clock': {
          this.running = req.running === true;
          this.owedMs = 0;
          return [...this.publish(false), this.ok(id, { time: this.sim.time })];
        }
        default:
          return [this.fail(id, 'BAD_REQUEST', `unknown request kind ${JSON.stringify(req.kind)}`)];
      }
    } catch (e) {
      return [this.fail(id, 'INTERNAL', e instanceof Error ? e.message : String(e))];
    }
  }

  /**
   * Real-time clock: `elapsedMs` of wall time has passed. Runs the ticks owed
   * (1 per ms) when the clock is running. Pushes a frame if anything changed,
   * otherwise an occasional `time` message.
   */
  advance(elapsedMs: number): SimMessage[] {
    if (!this.running) return [];
    this.owedMs += elapsedMs;
    const n = Math.min(Math.floor(this.owedMs), MAX_CATCH_UP_TICKS);
    this.owedMs = n === MAX_CATCH_UP_TICKS ? 0 : this.owedMs - n;
    if (n === 0) return [];
    if (this.sim.step(n)) return this.publish(false);
    this.sinceTimePush += elapsedMs;
    if (this.sinceTimePush < TIME_PUSH_MS) return [];
    this.sinceTimePush = 0;
    return [{ v: 1, kind: 'time', time: this.sim.time, running: this.running }];
  }

  private advanceBy(id: number, ticks: number): SimMessage[] {
    this.sim.step(ticks);
    return [...this.publish(false), this.ok(id, { time: this.sim.time })];
  }

  /** Frame (and the circuit first, if it changed). */
  private publish(circuitChanged: boolean): SimMessage[] {
    const revision = ++this.revision;
    this.sinceTimePush = 0;
    const frame: SimMessage = {
      v: 1,
      kind: 'frame',
      frame: {
        revision,
        time: this.sim.time,
        settled: this.sim.settled,
        running: this.running,
        ...this.sim.result,
      },
    };
    return circuitChanged
      ? [{ v: 1, kind: 'circuit', revision, circuit: this.circuit }, frame]
      : [frame];
  }

  private ok(id: number, result: { id?: string; time?: Simulation['time'] }): SimResponse {
    return { v: 1, kind: 'response', id, ok: true, result };
  }

  private fail(id: number, code: SimErrorCode, message: string): SimResponse {
    return { v: 1, kind: 'response', id, ok: false, error: { code, message } };
  }
}

/** Wall-clock source for the real-time loop; the worker passes the real one. */
export interface Clock {
  now(): number;
  every(ms: number, fn: () => void): void;
}

/**
 * Serve a SimService on a port (the worker global, or a MessagePort in tests).
 * With a clock, a real-time loop advances sim time while it is running; without
 * one (tests), time moves only on step/run requests.
 */
export function serveSim(
  port: PortLike,
  service: SimService = new SimService(),
  clock?: Clock,
): SimService {
  const send = (messages: SimMessage[]): void => {
    for (const m of messages) port.postMessage(m);
  };
  port.onmessage = (event) => send(service.handle(event.data));
  if (clock) {
    let last = clock.now();
    clock.every(4, () => {
      const now = clock.now();
      send(service.advance(now - last));
      last = now;
    });
  }
  return service;
}
