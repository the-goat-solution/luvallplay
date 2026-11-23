// Local stand-in for Neon's two network paths, for end-to-end tests only
// (see lib/local-neon.ts):
// - WebSocket → TCP: the Postgres wire protocol over a WebSocket (Pool/Client).
// - HTTP /sql: Neon's "SQL over HTTP" endpoint, which @vercel/postgres's
//   `sql` tag always uses. Answered with node-postgres, values returned as raw
//   text (the driver parses them by type, as it does with Neon).
//
//   node scripts/e2e/ws-proxy.mjs [port=5480] [pgPort=5432]
import http from "node:http";
import net from "node:net";
import pg from "pg";
import { WebSocketServer } from "ws";

const port = Number(process.argv[2] ?? 5480);
const pgPort = Number(process.argv[3] ?? 5432);
const raw = { getTypeParser: () => (v) => v };

async function runQuery(client, q, arrayMode) {
  const res = await client.query({ text: q.query, values: q.params ?? [], rowMode: arrayMode ? "array" : undefined, types: raw });
  return {
    command: res.command,
    rowCount: res.rowCount,
    rowAsArray: arrayMode,
    fields: res.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID, tableID: f.tableID, columnID: f.columnID, dataTypeSize: f.dataTypeSize, dataTypeModifier: f.dataTypeModifier, format: "text" })),
    rows: res.rows,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  const conn = req.headers["neon-connection-string"];
  const arrayMode = req.headers["neon-array-mode"] === "true";
  const client = new pg.Client({ connectionString: String(conn).replace(/@[^/]+\//, `@127.0.0.1:${pgPort}/`) });
  try {
    await client.connect();
    let out;
    if (Array.isArray(body.queries)) {
      await client.query("BEGIN");
      const results = [];
      for (const q of body.queries) results.push(await runQuery(client, q, arrayMode));
      await client.query("COMMIT");
      out = { results };
    } else {
      out = await runQuery(client, body, arrayMode);
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
  } catch (err) {
    if (Array.isArray(body.queries)) await client.query("ROLLBACK").catch(() => {});
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ message: err.message, code: err.code, detail: err.detail, constraint: err.constraint, table: err.table, column: err.column }));
  } finally {
    await client.end().catch(() => {});
  }
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  const tcp = net.connect(pgPort, "127.0.0.1");
  ws.binaryType = "nodebuffer";
  ws.on("message", (data) => tcp.write(data));
  tcp.on("data", (chunk) => ws.readyState === ws.OPEN && ws.send(chunk));
  const close = () => {
    tcp.destroy();
    if (ws.readyState === ws.OPEN) ws.close();
  };
  ws.on("close", close);
  ws.on("error", close);
  tcp.on("close", close);
  tcp.on("error", close);
});
server.listen(port, () => console.log(`neon stand-in: ws + http://localhost:${port} → postgres 127.0.0.1:${pgPort}`));
