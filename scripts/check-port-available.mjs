import { createServer } from "node:net";

const rawPort = process.env.PORT ?? "7860";
const port = Number.parseInt(rawPort, 10);
const host = process.env.HOST ?? "0.0.0.0";

function printPortBusyMessage() {
  console.error("");
  console.error(`  [ERROR] Port ${rawPort} is already in use.`);
  console.error("  Marinara Engine did not start, and the browser was not opened to avoid showing another local service.");
  console.error("  Close the app using that port or start Marinara on another port:");
  console.error("");
  console.error("    macOS/Linux:       PORT=7869 bash ./start.sh");
  console.error("    Windows PowerShell: $env:PORT=7869; .\\start.bat");
  console.error("    Windows cmd:        set PORT=7869 && start.bat");
  console.error("");
}

if (!Number.isFinite(port) || port <= 0 || port > 65_535) {
  console.error("");
  console.error(`  [ERROR] PORT must be a number from 1 to 65535. Received: ${rawPort}`);
  console.error("");
  process.exit(1);
}

const server = createServer();

server.once("error", (err) => {
  if (err && typeof err === "object" && "code" in err && err.code === "EADDRINUSE") {
    printPortBusyMessage();
  } else {
    console.error("");
    console.error(`  [ERROR] Could not check whether ${host}:${rawPort} is available.`);
    console.error(err);
    console.error("");
  }
  process.exit(1);
});

server.listen({ host, port }, () => {
  server.close(() => {
    process.exit(0);
  });
});
