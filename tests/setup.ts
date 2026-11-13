import { webcrypto } from "node:crypto";
// jsdom does not provide crypto.subtle; use Node's Web Crypto (same API as browsers).
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
