/*
 * Company names in the Admin page's Activity: an ERP's company events name its own customer
 * (contract version 3), so when the history is read each is given the Commerce company it is
 * about, by name. Each company is looked up once per read, however many records name it.
 */
import { nameCompanies } from "#lib/history-names";

const credit = (eventId, data) => ({
  direction: "from-erp",
  event: { data, type: "be-observer.company_credit_update" },
  eventId,
  kind: "credit",
  ref: String(data.partnerId ?? data.companyId),
});

function readers() {
  return {
    companyOf: vi.fn(
      async (partnerId, erpId) =>
        ({ "contoso|C-2231": "4", "erp|100042": "4", "erp|100051": "2" })[
          `${erpId}|${partnerId}`
        ] ?? null,
    ),
    nameOf: vi.fn(
      async (id) => ({ 2: "ServerSavvy Solutions", 4: "Kukla Studios" })[id],
    ),
  };
}

describe("Given the history as read", () => {
  test("Then each company event carries its Commerce company's id and name, each company read once", async () => {
    const deps = readers();
    const entries = [
      credit("e1", { creditLimit: 25_000, partnerId: "100051" }),
      credit("e2", { creditLimit: 50_000, partnerId: "100042" }),
      credit("e3", {
        creditLimit: 20_000,
        erpId: "contoso",
        partnerId: "C-2231",
      }),
      {
        ...credit("e4", { blocked: true, partnerId: "100042" }),
        kind: "block",
      },
      { ...credit("e5", { lines: [], partnerId: "100042" }), kind: "contract" },
    ];

    const named = await nameCompanies(entries, deps);

    expect(named.map((e) => e.company)).toStrictEqual([
      { id: "2", name: "ServerSavvy Solutions" },
      { id: "4", name: "Kukla Studios" },
      { id: "4", name: "Kukla Studios" },
      { id: "4", name: "Kukla Studios" },
      { id: "4", name: "Kukla Studios" },
    ]);
    // An event without an ERP id is the first ERP's (lib/erps.js eventErpId).
    expect(deps.companyOf).toHaveBeenCalledWith("100051", "erp");
    expect(deps.nameOf).toHaveBeenCalledTimes(2);
  });

  test("Then an event naming the Commerce company is named without the key map", async () => {
    const deps = readers();
    const [entry] = await nameCompanies(
      [credit("e1", { companyId: 2, creditLimit: 1 })],
      deps,
    );
    expect(entry.company).toStrictEqual({
      id: "2",
      name: "ServerSavvy Solutions",
    });
    expect(deps.companyOf).not.toHaveBeenCalled();
  });

  test("Then a customer no company is paired with, or a read that fails, leaves the record as it was", async () => {
    const deps = readers();
    deps.nameOf.mockRejectedValueOnce(new Error("Commerce is down"));
    const unpaired = credit("e1", { creditLimit: 1, partnerId: "100077" });
    const unread = credit("e2", { creditLimit: 1, partnerId: "100051" });
    const order = { direction: "to-erp", kind: "order", ref: "3000000021" };

    const named = await nameCompanies([unpaired, unread, order], deps);

    expect(named[0]).toBe(unpaired);
    expect(named[1]).toStrictEqual({ ...unread, company: { id: "2" } });
    expect(named[2]).toBe(order);
  });
});
