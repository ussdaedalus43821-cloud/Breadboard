// The real WorkerCircuitHost talking to the real SimService over a real
// MessageChannel: the same protocol path as the browser, minus the Worker.

import type { PortLike } from '../../src/protocol/sim-protocol';
import { WorkerCircuitHost, type HostOptions } from '../../src/ui/worker-circuit-host';
import { serveSim } from '../../src/worker/sim-service';

export interface Connected {
  readonly host: WorkerCircuitHost;
  close(): void;
}

export async function connectInProcess(options: HostOptions = {}): Promise<Connected> {
  const { port1, port2 } = new MessageChannel();
  serveSim(port2 as unknown as PortLike);
  const host = new WorkerCircuitHost(port1 as unknown as PortLike, options);
  await host.ready;
  return {
    host,
    close: () => {
      port1.close();
      port2.close();
    },
  };
}
