declare module 'osc' {
  import { EventEmitter } from 'events';

  interface UDPPortOptions {
    localAddress?: string;
    localPort?: number;
    remoteAddress?: string;
    remotePort?: number;
    metadata?: boolean;
    broadcast?: boolean;
    multicastMembership?: string[];
  }

  interface OSCMessage {
    address: string;
    args: Array<{ type: string; value: any }>;
  }

  interface OSCBundle {
    timeTag: { raw: [number, number]; native: number };
    packets: Array<OSCMessage | OSCBundle>;
  }

  class UDPPort extends EventEmitter {
    constructor(options?: UDPPortOptions);
    open(): void;
    close(): void;
    send(packet: OSCMessage | OSCBundle, address?: string, port?: number): void;
  }

  export { UDPPort, UDPPortOptions, OSCMessage, OSCBundle };
}
