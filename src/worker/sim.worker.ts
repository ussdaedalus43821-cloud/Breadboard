// Sim worker entry point. All logic lives in sim-service.ts; this file supplies
// the real clock that drives the 1 kHz tick loop, and attaches the NovaLang
// bridge when the main thread hands over a port for it.

import type { AttachBridge } from '../protocol/nova-protocol';
import type { PortLike, SimMessage } from '../protocol/sim-protocol';
import { serveBridge } from './bridge-server';
import { SimService, serveSim } from './sim-service';

const ui = self as unknown as PortLike;
const service = serveSim(ui, new SimService(), {
  now: () => performance.now(),
  every: (ms, fn) => setInterval(fn, ms),
});
const toUi = (messages: readonly SimMessage[]): void => {
  for (const m of messages) ui.postMessage(m);
};

const handleUi = ui.onmessage!;
ui.onmessage = (event) => {
  const data = event.data as Partial<AttachBridge> | null;
  if (data?.kind === 'attach-bridge' && data.buffer && event.ports[0]) {
    serveBridge(event.ports[0] as unknown as PortLike, data.buffer, service, toUi);
    return;
  }
  handleUi(event);
};
