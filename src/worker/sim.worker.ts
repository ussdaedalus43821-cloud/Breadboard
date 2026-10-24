// Sim worker entry point. All logic lives in sim-service.ts.

import type { PortLike } from '../protocol/sim-protocol';
import { serveSim } from './sim-service';

serveSim(self as unknown as PortLike);
