/*
 * The scope tree @adobe/aio-commerce-lib-config 1.8.0 builds for the Bodea sandbox, in the
 * library's own shape: `global`, then a `commerce` node whose children are websites, each
 * with its stores (is_editable false) and their store views (level `store_view`), every node
 * carrying `label`, not `name` (lib `dist/es/index.mjs`, mergeCommerceScopes,
 * buildStoreGroups, buildStoreViews, buildUpdatedScopeTree, createInitialScopeTree).
 *
 * The websites, stores and store views are Bodea's as its REST API answered on 2026-09-26
 * (store/websites, store/storeGroups, store/storeViews). Only the ids are made up: the
 * library mints them as UUIDs. The page's first tests used a flat list with `name` and
 * `storeView`, which the library never produces, and passed while the page showed no
 * websites at all.
 */

const node = (level, code, label, extra = {}) => ({
  code,
  id: `${level}-${code}`,
  is_editable: level !== "store" && level !== "commerce",
  is_final: true,
  is_removable: false,
  label,
  level,
  ...extra,
});

const website = (id, code, label, store, view) =>
  node("website", code, label, {
    children: [
      node("store", store.code, store.label, {
        children: [
          node("store_view", view.code, view.label, { commerce_id: view.id }),
        ],
        commerce_id: store.id,
      }),
    ],
    commerce_id: id,
  });

export const BODEA_SCOPE_TREE = [
  node("global", "global", "Global"),
  node("commerce", "commerce", "Commerce", {
    children: [
      website(
        0,
        "admin",
        "Admin",
        { code: "default", id: 0, label: "Default" },
        { code: "admin", id: 0, label: "Admin" },
      ),
      website(
        1,
        "base",
        "Main Website",
        { code: "main_website_store", id: 1, label: "Main Website Store" },
        { code: "default", id: 1, label: "Default Store View" },
      ),
      website(
        2,
        "citisignal",
        "CitiSignal Website",
        { code: "citisignal_store", id: 2, label: "CitiSignal Store" },
        { code: "citisignal_us", id: 2, label: "CitiSignal US" },
      ),
      website(
        3,
        "bodea",
        "Bodea Website",
        { code: "bodea_store", id: 3, label: "Bodea Store" },
        { code: "bodea_us", id: 3, label: "Bodea US" },
      ),
      website(
        4,
        "evo",
        "Evo",
        { code: "evo_store", id: 4, label: "Evo Store" },
        { code: "evo_us", id: 4, label: "Evo US" },
      ),
    ],
  }),
];
