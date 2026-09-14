// Fetch the ERP's current contract from GitHub and diff it against the vendored copy. A
// difference means the ERP moved: read it, update the handlers if needed, copy the file.
import { readFileSync } from "node:fs";

const url =
  "https://raw.githubusercontent.com/skukla/demo-erp/main/contract/erp-contract.json";
const vendored = JSON.parse(
  readFileSync(
    new URL("../contract/erp-contract.json", import.meta.url),
    "utf8",
  ),
);
const res = await fetch(url);
if (!res.ok) {
  console.error(`could not fetch ${url}: ${res.status}`);
  process.exit(2);
}
const upstream = await res.json();
const a = JSON.stringify(vendored, null, 2);
const b = JSON.stringify(upstream, null, 2);
if (a === b) {
  console.log("contract in step with skukla/demo-erp main");
  process.exit(0);
}
console.error("the ERP's contract differs from the vendored copy. Upstream:");
console.error(b);
process.exit(1);
