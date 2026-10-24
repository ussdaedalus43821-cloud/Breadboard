// Serves the NovaLang bridge on a MessagePort from the nova worker. Each request
// is answered through the shared response buffer (the nova worker is blocked in
// Atomics.wait); circuit/frame pushes go to the UI like any other edit's.

import { BRIDGE_VERSION } from '../protocol/bridge';
import type { PortLike, SimMessage } from '../protocol/sim-protocol';
import { RESPONSE_CAPACITY, writeResponse } from '../protocol/sync-buffer';
import { handleBridge } from './bridge';
import type { SimService } from './sim-service';

export function serveBridge(
  port: PortLike,
  buffer: SharedArrayBuffer,
  service: SimService,
  toUi: (messages: readonly SimMessage[]) => void,
): void {
  port.onmessage = (event) => {
    const { response, pushes } = handleBridge(service, event.data);
    toUi(pushes);
    if (!writeResponse(buffer, JSON.stringify(response))) {
      writeResponse(
        buffer,
        JSON.stringify({
          v: BRIDGE_VERSION,
          id: response.id,
          ok: false,
          error: { code: 'LIMIT', message: `response larger than ${RESPONSE_CAPACITY} bytes` },
        }),
      );
    }
  };
}
