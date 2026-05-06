import { createServer } from "node:http";
import { promises as dns } from "node:dns";
import { safeFetch } from "../packages/server/src/utils/security.js";

const hostname = `${process.env.COMPUTERNAME ?? "localhost"}.local`;

const server = createServer((req, res) => {
  if (req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "mock-local-model", name: "Mock Local Model" }] }));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

async function listen() {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => resolve());
  });
}

async function close() {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

await listen();

try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind to a TCP port");
  const url = `http://${hostname}:${address.port}/v1/models`;
  const records = await dns.lookup(hostname, { all: true, verbatim: true });

  console.log(`HOSTNAME: ${hostname}`);
  console.log(`URL: ${url}`);
  console.log(`RESOLVED: ${records.map((record) => `${record.address}/${record.family}`).join(", ")}`);

  await safeFetch(url, {
    policy: {
      allowLoopback: true,
      allowMdns: true,
      allowedProtocols: ["http:", "https:"],
    },
    maxResponseBytes: 1024 * 1024,
  })
    .then(async (response) => {
      console.log(`STATUS: ${response.status}`);
      console.log(`BODY: ${await response.text()}`);
      if (!response.ok) process.exitCode = 1;
    })
    .catch((err) => {
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
} finally {
  await close();
}
