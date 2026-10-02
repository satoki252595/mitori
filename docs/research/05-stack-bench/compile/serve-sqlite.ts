import { Database } from "bun:sqlite"
if (process.argv.includes("--selftest")) {
  const db = new Database(":memory:"); db.exec("create table t(a)"); db.exec("insert into t values (1),(2)")
  const s = Bun.serve({ port: 0, fetch: () => new Response("ok") })
  const r = await (await fetch(`http://localhost:${s.port}`)).text()
  console.log("selftest", r, db.query("select count(*) c from t").get()); s.stop(); process.exit(0)
}
console.log("mitori 0.0.0")
