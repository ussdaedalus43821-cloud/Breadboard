// Sim worker entry point. All logic lives in sim-service.ts; this file only
// supplies the real clock that drives the 1 kHz tick loop.

import type { PortLike } from '../protocol/sim-protocol';
import { SimService, serveSim } from './sim-service';

serveSim(self as unknown as PortLike, new SimService(), {
  now: () => performance.now(),
  every: (ms, fn) => setInterval(fn, ms),
});
