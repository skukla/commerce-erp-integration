/*
 * The Overview's one search box: what the text typed is taken to be. An order number opens the
 * order's trace, a short number a Commerce company, anything else a SKU and then a company name.
 */
import { searchTarget } from "#web/search-view.js";

describe("Given what is typed in the search box", () => {
  test.each([
    ["3000000023", { kind: "order", ref: "3000000023" }],
    ["#3000000023", { kind: "order", ref: "3000000023" }],
    ["000000042", { kind: "order", ref: "000000042" }],
    ["4", { id: "4", kind: "company" }],
    ["company 4", { id: "4", kind: "company" }],
    ["  accesspoint ", { kind: "text", text: "accesspoint" }],
    ["Kukla Studios", { kind: "text", text: "Kukla Studios" }],
    ["", null],
    ["   ", null],
  ])("Then %j is looked for as %j", (typed, target) => {
    expect(searchTarget(typed)).toStrictEqual(target);
  });
});
