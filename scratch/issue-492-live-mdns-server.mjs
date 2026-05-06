import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const hostname = `${process.env.COMPUTERNAME ?? "localhost"}.local`;

const server = createServer((req, res) => {
  if (req.url === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/proof") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Issue #492 live .local proof</title>
    <style>
      body {
        color: #15171a;
        font-family: "Segoe UI", Arial, sans-serif;
        margin: 32px;
        max-width: 980px;
      }
      h1 {
        font-size: 28px;
        margin: 0 0 18px;
      }
      .grid {
        display: grid;
        gap: 12px;
      }
      .row {
        border: 1px solid #c9ced6;
        border-radius: 6px;
        padding: 12px 14px;
      }
      .label {
        color: #4a5563;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        margin-bottom: 6px;
        text-transform: uppercase;
      }
      code,
      pre {
        background: #f5f7fa;
        border-radius: 4px;
        font-family: Consolas, "SFMono-Regular", monospace;
      }
      code {
        padding: 2px 4px;
      }
      pre {
        margin: 0;
        overflow: auto;
        padding: 12px;
        white-space: pre-wrap;
      }
      .pass {
        color: #0f7b45;
        font-weight: 700;
      }
      .fail {
        color: #b42318;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <h1>Issue #492 live .local provider proof</h1>
    <div class="grid">
      <section class="row">
        <div class="label">Loaded proof page URL</div>
        <code id="page-url"></code>
      </section>
      <section class="row">
        <div class="label">Provider models endpoint fetched by this page</div>
        <code id="models-url"></code>
      </section>
      <section class="row">
        <div class="label">Fetch result</div>
        <div id="status">pending</div>
      </section>
      <section class="row">
        <div class="label">Raw /v1/models response</div>
        <pre id="body">pending</pre>
      </section>
    </div>
    <script>
      const pageUrl = window.location.href;
      const modelsUrl = new URL("/v1/models", window.location.href).href;
      document.getElementById("page-url").textContent = pageUrl;
      document.getElementById("models-url").textContent = modelsUrl;
      fetch(modelsUrl)
        .then(async (response) => {
          const body = await response.text();
          const statusEl = document.getElementById("status");
          statusEl.textContent = "HTTP " + response.status + " " + response.statusText;
          statusEl.className = response.ok ? "pass" : "fail";
          document.getElementById("body").textContent = body;
        })
        .catch((error) => {
          const statusEl = document.getElementById("status");
          statusEl.textContent = "ERROR";
          statusEl.className = "fail";
          document.getElementById("body").textContent = error instanceof Error ? error.message : String(error);
        });
    </script>
  </body>
</html>`);
    return;
  }

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
  const proofUrl = `http://${hostname}:${address.port}/proof`;
  writeFileSync(resolve(import.meta.dirname, "issue-492-live-mdns-url.txt"), url);
  writeFileSync(resolve(import.meta.dirname, "issue-492-live-mdns-proof-url.txt"), proofUrl);
  console.log(url);
  console.log(proofUrl);
});
