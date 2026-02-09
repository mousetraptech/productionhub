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

  /** Write an OSC message to a Buffer */
  function writeMessage(msg: OSCMessage): Buffer;

  /** Write an OSC bundle to a Buffer */
  function writeBundle(bundle: OSCBundle): Buffer;

  /** Read an OSC message from a Buffer */
  function readMessage(data: Buffer | Uint8Array, options?: any): OSCMessage;

  export { UDPPort, UDPPortOptions, OSCMessage, OSCBundle, writeMessage, writeBundle, readMessage };
}
