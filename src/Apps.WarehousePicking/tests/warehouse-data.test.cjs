const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function loadData() {
  const calls = [];
  const queries = [];
  const mutations = [];
  const toasts = [];
  const invalidations = [];
  const snapshots = {};
  const services = {};
  for (const name of ["items", "transactions", "locations"]) {
    services[name] = {
      create: async payload => {
        calls.push({ service: name, action: "create", payload });
        return { success: true, data: payload };
      },
      update: async (id, payload) => {
        calls.push({ service: name, action: "update", id, payload });
        return { success: true, data: payload };
      },
      get: async id => ({ success: true, data: { lab_warehouseitemid: id, lab_availablequantity: "95" } }),
      getAll: async options => {
        calls.push({ service: name, action: "getAll", options });
        return { success: true, data: [] };
      },
    };
  }
  const cache = {};
  const element = (type, props) => ({ type, props });
  const queryClient = {
    invalidateQueries: async () => {
      invalidations.push(true);
      for (const query of queries) await query.queryFn();
    },
    refetchQueries: async () => {},
  };
  const mocks = {
    "@/generated/services/Lab_warehouseitemsService": { Lab_warehouseitemsService: services.items },
    "@/generated/services/Lab_warehousetransactionsService": { Lab_warehousetransactionsService: services.transactions },
    "@/generated/services/Lab_warehouselocationsService": { Lab_warehouselocationsService: services.locations },
    "react": {
      useMemo: fn => fn(),
      useState: initial => [initial, () => {}],
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "Fragment" },
    "react-router-dom": { useParams: () => ({ id: "item-id" }), useNavigate: () => () => {} },
    "@tanstack/react-query": {
      useQueryClient: () => queryClient,
      useQuery: options => {
        queries.push(options);
        return { data: snapshots[options.queryKey[0]], isLoading: false };
      },
      useMutation: options => {
        mutations.push(options);
        return {
          mutateAsync: async values => {
            let result;
            try {
              result = await options.mutationFn(values);
            } catch (error) {
              options.onError?.(error);
              throw error;
            }
            await options.onSuccess?.(result);
            return result;
          },
          isPending: false,
        };
      },
    },
    "@/hooks/use-toast": { useToast: () => ({
      success: text => toasts.push({ intent: "success", text }),
      error: text => toasts.push({ intent: "error", text }),
    }) },
  };
  function load(id) {
    if (mocks[id]) return mocks[id];
    if (cache[id]) return cache[id];
    if (id.startsWith("@/components/") || id.startsWith("@fluentui/")) {
      return new Proxy({}, { get: (_, key) => key });
    }
    if (id.startsWith("@/styles/")) return { useStyles: () => ({}) };
    assert.ok(id.startsWith("@/"), `Unexpected runtime import ${id}`);
    const filename = path.join(__dirname, "../src", id.slice(2) + (id.startsWith("@/pages/") ? ".tsx" : ".ts"));
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(output, { module, exports: module.exports, require: load, console, Error, Date });
    cache[id] = module.exports;
    return module.exports;
  }
  return {
    data: load("@/utils/WarehouseData"), errors: load("@/utils/ServicePayload"), services, calls,
    queries, mutations, toasts, invalidations, snapshots,
    renderPage: name => load(`@/pages/${name}`).default(),
  };
}

for (const type of [100000000, 100000001]) {
  test(`transaction type ${type} sends exact fields and binds the item's id`, async () => {
    const { data, calls } = loadData();
    const before = Date.now();
    await data.createTransaction({ lab_name: "Stock movement", lab_quantity: 5, lab_transactiontype: type }, "item-id");
    const { payload } = calls[0];
    assert.equal(payload.lab_name, "Stock movement");
    assert.equal(payload.lab_quantity, "5");
    assert.equal(payload.lab_transactiontype, type);
    assert.equal(payload["lab_itemid@odata.bind"], "/lab_warehouseitems(item-id)");
    assert.ok(Date.parse(payload.lab_transactiondate) >= before);
    assert.deepEqual(Object.keys(payload).sort(), [
      "lab_itemid@odata.bind", "lab_name", "lab_quantity", "lab_transactiondate", "lab_transactiontype",
    ]);
  });
}

test("transaction from the Transactions screen binds the selected item", async () => {
  const { data, calls } = loadData();
  await data.createTransaction({
    lab_name: "Pick", lab_quantity: "5", lab_transactiontype: "100000001", lab_itemid: "selected-item",
  });
  assert.equal(calls[0].payload["lab_itemid@odata.bind"], "/lab_warehouseitems(selected-item)");
});

for (const field of ["lab_name", "lab_quantity", "lab_transactiontype", "lab_itemid"]) {
  for (const missing of [undefined, null, ""]) {
    test(`missing ${field} (${missing}) prevents saving`, () => {
      const { data, calls } = loadData();
      const values = {
        lab_name: "Pick", lab_quantity: 5, lab_transactiontype: 100000001, lab_itemid: "item-id",
        [field]: missing,
      };
      assert.throws(() => data.createTransaction(values), { message: "Fill all required fields." });
      assert.equal(calls.length, 0);
    });
  }
}

test("zero, negative and above-stock quantities are sent to the server, not compared locally", async () => {
  const { data, calls } = loadData();
  for (const quantity of [0, -1, 999999]) {
    await data.createTransaction({
      lab_name: "Server decides", lab_quantity: quantity, lab_transactiontype: 100000001,
    }, "item-id");
  }
  assert.deepEqual(calls.map(call => call.payload.lab_quantity), ["0", "-1", "999999"]);
  assert.ok(calls.every(call => call.action === "create"));
});

test("rejected service results preserve the server's over-pick error and do not update stock", async () => {
  const { data, errors, services, calls } = loadData();
  const message = "Not enough product in stock. Available: 5, requested: 6.";
  services.transactions.create = async () => ({
    success: false, data: undefined, error: { message: JSON.stringify({ error: { code: "0x80040265", message } }) },
  });
  await assert.rejects(data.createTransaction({
    lab_name: "Pick", lab_quantity: 6, lab_transactiontype: 100000001,
  }, "item-id"), { message });
  assert.equal(errors.errorText(new Error(message)), message);
  assert.equal(calls.length, 0);
});

test("thrown service errors retain their server message", async () => {
  const { data, errors, services } = loadData();
  const message = "Permission denied.";
  services.transactions.create = async () => { throw new Error(message); };
  await assert.rejects(data.createTransaction({
    lab_name: "Pick", lab_quantity: 5, lab_transactiontype: 100000001,
  }, "item-id"), { message });
  assert.equal(errors.errorText({ message }), message);
  assert.equal(errors.errorText(JSON.stringify({ error: { message } })), message);
});

test("successful service response with missing data is an explicit error", async () => {
  const { errors } = loadData();
  await assert.rejects(errors.serviceData(Promise.resolve({ success: true })), {
    message: "The service returned no data.",
  });
});

test("all list pages are fetched through the generated service, including empty final pages", async () => {
  const { data } = loadData();
  const requested = [];
  const rows = await data.allRecords(async options => {
    requested.push(options.skipToken);
    return options.skipToken
      ? { success: true, data: [{ id: "two" }] }
      : { success: true, data: [{ id: "one" }], skipToken: "page-two" };
  });
  assert.deepEqual(Array.from(rows, row => row.id), ["one", "two"]);
  assert.deepEqual(requested, [undefined, "page-two"]);
  const empty = await data.allRecords(async () => ({ success: true, data: [] }));
  assert.equal(empty.length, 0);
});

test("failed later pages, missing arrays and repeated pagination tokens are errors, not partial lists", async () => {
  const { data } = loadData();
  await assert.rejects(data.allRecords(async options => options.skipToken
    ? { success: false, error: new Error("Page failed") }
    : { success: true, data: [1], skipToken: "next" }), { message: "Page failed" });
  await assert.rejects(data.allRecords(async () => ({ success: true })), {
    message: "The service returned no records.",
  });
  await assert.rejects(data.allRecords(async () => ({ success: true, data: [], skipToken: "again" })), {
    message: "The service repeated a pagination token.",
  });
});

test("item history is filtered by lookup GUID and sorted by creation time, newest first", async () => {
  const { data, calls } = loadData();
  await data.listTransactions("{12345678-1234-1234-1234-123456789abc}");
  assert.equal(calls[0].options.filter, "_lab_itemid_value eq 12345678-1234-1234-1234-123456789abc");
  assert.deepEqual(Array.from(calls[0].options.orderBy), ["createdon desc", "lab_warehousetransactionid desc"]);
  await data.listTransactions();
  assert.equal(calls[1].options.filter, undefined);
});

test("new item accepts zero on hand, exact category and optional location binding", async () => {
  const { data, calls } = loadData();
  const values = { lab_name: "Mouse", lab_sku: "MSE-001", lab_availablequantity: 0, lab_category: "100000000" };
  await data.createItem(values);
  assert.equal(calls[0].payload.lab_availablequantity, "0");
  assert.equal(calls[0].payload.lab_category, 100000000);
  assert.ok(!("lab_locationid@odata.bind" in calls[0].payload));
  await data.createItem({ ...values, lab_locationid: "location-id" });
  assert.equal(calls[1].payload["lab_locationid@odata.bind"], "/lab_warehouselocations(location-id)");
});

test("location create sends name, address and capacity through its generated service", async () => {
  const { data, calls } = loadData();
  await data.createLocation({ lab_name: "Main", lab_address: "1 High Street", lab_capacity: 0 });
  assert.equal(calls[0].service, "locations");
  assert.equal(calls[0].payload.lab_name, "Main");
  assert.equal(calls[0].payload.lab_address, "1 High Street");
  assert.equal(calls[0].payload.lab_capacity, "0");
  assert.throws(() => data.createLocation({ lab_name: "" }), { message: "Fill all required fields." });
});

test("item edits do not write available quantity; clearing the location sends null", async () => {
  const { data, calls } = loadData();
  await data.updateItem("item-id", { lab_name: "Mouse", lab_availablequantity: 900, lab_locationid: null });
  assert.equal(calls[0].id, "item-id");
  assert.equal(calls[0].payload.lab_name, "Mouse");
  assert.equal(calls[0].payload["lab_locationid@odata.bind"], null);
  assert.ok(!("lab_availablequantity" in calls[0].payload));
});

function findComponent(node, type) {
  if (!node || typeof node !== "object") return undefined;
  if (node.type === type) return node;
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
    const result = findComponent(child, type);
    if (result) return result;
  }
}

test("item detail submits through the server and refetches quantity and newest-first history before success", async () => {
  const harness = loadData();
  const { snapshots, services, calls } = harness;
  snapshots.warehouseItem = {
    lab_warehouseitemid: "item-id", lab_name: "Laptop", lab_sku: "LTP-001",
    lab_availablequantity: "100", lab_category: 100000000, statecode: 0,
  };
  snapshots.itemTransactions = [];
  snapshots.warehouseLocations = [];
  let serverStock = 100;
  services.items.get = async () => {
    calls.push({ action: "get", stock: serverStock });
    return { success: true, data: { ...snapshots.warehouseItem, lab_availablequantity: String(serverStock) } };
  };
  services.transactions.create = async payload => {
    calls.push({ action: "create", payload });
    // This is the mocked server rule, not client code.
    serverStock -= Number(payload.lab_quantity);
    return { success: true, data: payload };
  };
  const page = harness.renderPage("WarehouseItemDetail");
  const dialog = findComponent(page, "RecordFormDialog");
  assert.ok(dialog);
  assert.ok(dialog.props.fields.every(field => field.required));
  assert.ok(dialog.props.fields.every(field => !field.column.metadata?.MinValue));
  await dialog.props.onCreate({ lab_name: "Pick", lab_quantity: 5, lab_transactiontype: 100000001 });
  assert.equal(serverStock, 95);
  assert.equal(harness.invalidations.length, 1);
  assert.ok(calls.some(call => call.action === "get" && call.stock === 95));
  assert.ok(calls.some(call => call.action === "getAll" && call.service === "transactions"
    && call.options.orderBy[0] === "createdon desc"));
  assert.equal(harness.toasts.at(-1).intent, "success");
});

test("over-pick failure remains the server's exact message, with no success or optimistic refresh", async () => {
  const harness = loadData();
  harness.snapshots.warehouseItem = {
    lab_warehouseitemid: "item-id", lab_name: "Mouse", lab_sku: "MSE-001",
    lab_availablequantity: "5", lab_category: 100000000, statecode: 0,
  };
  const message = "Not enough product in stock. Available: 5, requested: 6.";
  harness.services.transactions.create = async () => ({
    success: false, error: { message: JSON.stringify({ error: { message } }) },
  });
  const dialog = findComponent(harness.renderPage("WarehouseItemDetail"), "RecordFormDialog");
  await assert.rejects(dialog.props.onCreate({
    lab_name: "Pick", lab_quantity: 6, lab_transactiontype: 100000001,
  }), { message });
  assert.deepEqual(harness.toasts, [{ intent: "error", text: message }]);
  assert.equal(harness.invalidations.length, 0);
  assert.equal(harness.snapshots.warehouseItem.lab_availablequantity, "5");
});

test("Locations maps item counts and creates through its generated service", async () => {
  const harness = loadData();
  harness.snapshots.warehouseLocationsList = [
    { lab_warehouselocationid: "main", lab_name: "Main", lab_isactive: true },
    { lab_warehouselocationid: "overflow", lab_name: "Overflow", lab_isactive: false },
  ];
  harness.snapshots.itemsByLocation = [
    { _lab_locationid_value: "main" }, { _lab_locationid_value: "main" }, { _lab_locationid_value: null },
  ];
  const page = harness.renderPage("Locations");
  const grid = findComponent(page, "RecordGrid");
  assert.deepEqual(Array.from(grid.props.rows, row => row.itemCount), [2, 0]);
  const dialog = findComponent(page, "RecordFormDialog");
  await dialog.props.onCreate({ lab_name: "New", lab_address: "Address", lab_capacity: 20 });
  assert.equal(harness.calls[0].service, "locations");
  assert.equal(harness.toasts.at(-1).text, "Location created successfully");
});

test("Items displays quantity, category and resolved location; successful creation refreshes lists", async () => {
  const harness = loadData();
  harness.snapshots.warehouseItems = [
    { lab_warehouseitemid: "item-id", lab_name: "Mouse", lab_availablequantity: "5",
      lab_category: 100000000, _lab_locationid_value: "main", statecode: 0 },
  ];
  harness.snapshots.warehouseLocations = [{ lab_warehouselocationid: "main", lab_name: "Main" }];
  const page = harness.renderPage("WarehouseItems");
  const row = findComponent(page, "RecordGrid").props.rows[0];
  assert.equal(row.lab_availablequantity, 5);
  assert.equal(row.lab_category, 100000000);
  assert.equal(row.location, "Main");
  await findComponent(page, "RecordFormDialog").props.onCreate({
    lab_name: "New", lab_sku: "NEW", lab_availablequantity: 0, lab_category: 100000000,
  });
  assert.equal(harness.invalidations.length, 1);
  assert.equal(harness.toasts.at(-1).text, "Item created successfully");
});

test("Transactions allows choosing any item and uses the same server transaction path", async () => {
  const harness = loadData();
  harness.snapshots.allTransactions = [];
  harness.snapshots.warehouseItemsLookup = [
    { lab_warehouseitemid: "active", lab_name: "Active", statecode: 0 },
    { lab_warehouseitemid: "inactive", lab_name: "Inactive", statecode: 1 },
  ];
  const dialog = findComponent(harness.renderPage("Transactions"), "RecordFormDialog");
  assert.equal(dialog.props.lookupRecords.lab_itemid.length, 2);
  await dialog.props.onCreate({
    lab_name: "Receive", lab_quantity: 10, lab_transactiontype: 100000000, lab_itemid: "active",
  });
  assert.equal(harness.calls[0].payload["lab_itemid@odata.bind"], "/lab_warehouseitems(active)");
  assert.equal(harness.invalidations.length, 1);
});
