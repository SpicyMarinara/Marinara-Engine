import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const hostname = `${process.env.COMPUTERNAME ?? "localhost"}.local`;

const server = createServer((req, res) => {
  if (req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        {
          proof: "Issue #492 live .local provider response",
          hostname,
          data: [{ id: "mock-local-model", name: "Mock Local Model" }],
        },
        null,
        2,
      ),
    );
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(0, "0.0.0.0", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not bind to a TCP port");
  }
  const url = `http://${hostname}:${address.port}/v1/models`;
  writeFileSync(resolve(import.meta.dirname, "issue-492-live-mdns-url.txt"), url);
  console.log(url);
});
