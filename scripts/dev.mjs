import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { parseArgs, promisify } from "node:util";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const { values } = parseArgs({
  args,
  strict: false,
  allowPositionals: true,
  options: {
    port: { type: "string", short: "p" },
    hostname: { type: "string", short: "H" },
  },
});
const automaticPort = values.port === undefined;
const hostname = values.hostname ?? "0.0.0.0";
let port = Number(process.env.PORT ?? 3001);
let child;
let stopping = false;

async function getListeningPorts() {
  if (process.platform !== "win32") return new Set();

  // Windows can report a port as bindable while another service listens on it.
  const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "tcp"], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const ports = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    const listener = line.match(/^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+\d+\s*$/i);
    const port = listener?.[1].match(/:(\d+)$/)?.[1];
    if (port) ports.add(Number(port));
  }
  return ports;
}

function canListen(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    server.listen(port, hostname, () => server.close(() => resolve(true)));
  });
}

async function start() {
  if (automaticPort) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("起始端口必须是 1 到 65535 之间的整数。");
    }
    const listeningPorts = await getListeningPorts();
    while (listeningPorts.has(port) || !(await canListen(port))) {
      console.log(`端口 ${port} 已被占用，尝试 ${port + 1}。`);
      if (++port > 65535) throw new Error("没有可用的开发服务端口。");
    }
  }
  if (stopping) return;

  child = spawn(process.execPath, [
    require.resolve("next/dist/bin/next"),
    "dev",
    "--hostname", hostname,
    ...(automaticPort ? ["--port", String(port)] : []),
    ...args,
  ], { stdio: ["inherit", "inherit", "pipe"] });

  let errorOutput = "";
  child.stderr.on("data", (data) => {
    process.stderr.write(data);
    errorOutput = (errorOutput + data.toString()).slice(-8192);
  });
  child.once("error", fail);
  child.once("close", (code, signal) => {
    // Retry if another process claims the port after the availability check.
    if (!stopping && automaticPort && /listen EADDRINUSE/.test(errorOutput)) {
      console.log(`端口 ${port} 已被占用，尝试 ${port + 1}。`);
      port += 1;
      start().catch(fail);
      return;
    }
    process.exitCode = stopping ? 0 : (code ?? (signal ? 1 : 0));
  });
}

function fail(error) {
  console.error(error.message);
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    if (child?.pid && process.platform === "win32") {
      // Windows kill() only stops the CLI; also stop its Next.js worker.
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      }).once("error", fail);
    } else {
      child?.kill(signal);
    }
  });
}

start().catch(fail);
