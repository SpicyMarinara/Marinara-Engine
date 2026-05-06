import assert from "node:assert/strict";
import { promises as dns } from "node:dns";
import { validateOutboundUrl } from "../packages/server/src/utils/security.js";

const providerPolicy = {
  allowLoopback: true,
  allowMdns: true,
  allowedProtocols: ["http:", "https:"],
};

async function run() {
  const target = "http://name.local:5001/v1";
  const originalLookup = dns.lookup;
  dns.lookup = (async (hostname: string) => {
    if (hostname === "name.local") return [{ address: "192.168.1.50", family: 4 }];
    return originalLookup(hostname, { all: true, verbatim: true } as never) as never;
  }) as typeof dns.lookup;

  try {
    await assert.rejects(
      () => validateOutboundUrl(target, { allowedProtocols: ["http:", "https:"] }),
      /local or reserved/,
    );
    console.log("BEFORE/DEFAULT: .local URL is rejected by the generic outbound policy");

    const parsed = await validateOutboundUrl(target, providerPolicy);
    assert.equal(parsed.href, target);
    console.log("AFTER/PROVIDER: .local provider URL is accepted");
  } catch (err) {
    console.log(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    dns.lookup = originalLookup;
  }
}

await run();
