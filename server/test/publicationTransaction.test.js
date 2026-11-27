const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { spawnSync } = require("node:child_process");
const modulePath =
  require.resolve("../games/fact-or-cap/publicationTransaction");
const { recoverPublication } = require(modulePath);
function crash(t, stage) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-fault-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = {
    transactionDirectory: path.join(root, "tx"),
    temporaryEvidenceDirectory: path.join(root, "temp"),
    generalLedger: path.join(root, "ledger.json"),
  };
  const contentDirectories = { "fact-or-cap": path.join(root, "bank") };
  fs.mkdirSync(contentDirectories["fact-or-cap"]);
  fs.writeFileSync(paths.generalLedger, "old");
  const pack = path.join(contentDirectories["fact-or-cap"], "new.json");
  const script = `
    const fs=require("node:fs"), path=require("node:path");
    const {paths,contentDirectories,pack,stage,modulePath}=JSON.parse(process.argv[1]);
    const io=new Proxy(fs,{get(target,key){
      if(!["mkdirSync","linkSync","renameSync","unlinkSync","openSync"].includes(key))return target[key];
      return (...args)=>{
        if(stage==="early-staging" && key==="openSync" && path.dirname(args[0])===contentDirectories["fact-or-cap"] && args[1]==="wx") throw Error("fixture staging failure");
        if(stage==="race" && key==="linkSync" && args[1]===pack) fs.writeFileSync(pack,"foreign");
        if(stage==="concurrent" && key==="renameSync" && args[0]===paths.generalLedger) fs.writeFileSync(paths.generalLedger,"other ledger");
        if(stage==="rollback" && key==="linkSync" && args[1]===path.join(paths.temporaryEvidenceDirectory,"new.json")) throw Error("fixture receipt install failure");
        const out=target[key](...args);
        if((stage==="no-journal" && key==="mkdirSync" && args[0]===paths.transactionDirectory) ||
            (stage==="partial" && key==="linkSync" && args[1]===pack) ||
            (stage==="displaced" && key==="renameSync" && args[0]===paths.generalLedger) ||
            (stage==="rollback" && key==="unlinkSync" && args[0]===paths.generalLedger) ||
            (stage==="committed" && key==="unlinkSync" && String(args[0]).endsWith(".ledger.bak"))) process.exit(77);
        return out;
      };
    }});
    require(modulePath).applyTransaction({paths,contentDirectories,fileSystem:io,ledgerPath:paths.generalLedger,ledgerOldBytes:Buffer.from("old"),fileWrites:[
      {path:pack,kind:"new",contents:Buffer.from("pack")},{path:paths.generalLedger,kind:"replace",contents:Buffer.from("new")},
      {path:path.join(paths.temporaryEvidenceDirectory,"new.json"),kind:"new",contents:Buffer.from("receipt")}]});
  `;
  const out = spawnSync(
    process.execPath,
    [
      "-e",
      script,
      JSON.stringify({ paths, contentDirectories, pack, stage, modulePath }),
    ],
    { encoding: "utf8" },
  );
  return {
    paths,
    pack,
    contentDirectories,
    out,
    recover: () => recoverPublication({ paths, contentDirectories }),
  };
}
for (const stage of [
  "no-journal",
  "partial",
  "displaced",
  "committed",
  "race",
  "concurrent",
  "early-staging",
  "rollback",
])
  test("transaction interruption: " + stage, (t) => {
    const f = crash(t, stage),
      read = (file) => fs.readFileSync(file, "utf8");
    if (stage === "early-staging") {
      assert.equal(f.out.status, 1);
      assert.match(f.out.stderr, /rolled back/);
      assert.equal(fs.existsSync(f.paths.temporaryEvidenceDirectory), false);
      assert.equal(f.recover().state, "idle");
      return;
    }
    if (stage === "race" || stage === "concurrent") {
      assert.equal(f.out.status, 1);
      assert.throws(f.recover);
      if (stage === "race") assert.equal(read(f.pack), "foreign");
      else assert.equal(read(f.paths.generalLedger), "other ledger");
      return;
    }
    assert.equal(f.out.status, 77, f.out.stderr);
    if (stage === "no-journal") {
      assert.throws(f.recover, /No transaction journal/);
      return;
    }
    if (stage === "committed") {
      assert.equal(read(f.pack), "pack");
      assert.equal(read(f.paths.generalLedger), "new");
      assert.equal(f.recover().state, "committed");
    } else {
      assert.equal(f.recover().state, "rolled-back");
      assert.equal(fs.existsSync(f.pack), false);
      assert.equal(read(f.paths.generalLedger), "old");
    }
    assert.equal(f.recover().state, "idle");
  });
test("a late recovery conflict preserves earlier artifacts and a malformed journal", (t) => {
  const f = crash(t, "displaced");
  fs.writeFileSync(f.paths.generalLedger, "foreign");
  assert.throws(f.recover, /Unexpected/);
  assert.equal(fs.readFileSync(f.pack, "utf8"), "pack");
  const journal = path.join(f.paths.transactionDirectory, "transaction.json");
  fs.writeFileSync(journal, "{}");
  assert.throws(f.recover, /Invalid/);
  assert.equal(fs.readFileSync(journal, "utf8"), "{}");
});

test("a cooperating second publisher and recovery cannot take over a live transaction", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sussed-exclusive-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ledger = path.join(root, "ledger.json"),
    dir = path.join(root, "bank"),
    evidence = path.join(root, "evidence");
  fs.mkdirSync(dir);
  fs.writeFileSync(ledger, "old");
  const options = {
    ledgerPath: ledger,
    ledgerOldBytes: Buffer.from("old"),
    contentDirectories: { "fact-or-cap": dir },
    paths: {
      generalLedger: ledger,
      transactionDirectory: path.join(root, "transaction"),
      temporaryEvidenceDirectory: evidence,
    },
    fileWrites: [
      {
        path: path.join(dir, "new.json"),
        contents: Buffer.from("pack"),
        kind: "new",
      },
      { path: ledger, contents: Buffer.from("new"), kind: "replace" },
      {
        path: path.join(evidence, "new.json"),
        contents: Buffer.from("receipt"),
        kind: "new",
      },
    ],
  };
  const { applyTransaction } = require(modulePath);
  let checks = 0;
  applyTransaction({
    ...options,
    check: () => {
      checks++;
      assert.throws(() => applyTransaction(options), /already exists/);
      if (checks === 2)
        assert.throws(() => recoverPublication(options), /active/);
    },
  });
  assert.equal(checks, 2);
  assert.equal(fs.readFileSync(ledger, "utf8"), "new");
});
