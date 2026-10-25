const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { File } = require("node:buffer");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const jpeg = new Uint8Array([255, 216, 255, 224, 1]);
const ok = data => ({ success: true, data });
const catalog = { name: "Nutella", ean: "3017620422003", brand: "Nutella, Ferrero", quantity: "400 g e", imageUrl: "https://images.openfoodfacts.org/nutella.png" };
const preview = { barcode: "3017620422003", product: catalog };

function setup() {
  const calls = [];
  const products = {
    getAll: async options => { calls.push(["find", options]); return ok([]); },
    create: async payload => { calls.push(["create", payload]); return ok({ lab_productid: "new-product" }); },
    upload: async (...args) => { calls.push(["upload", ...args]); return ok(); },
    get: async id => { calls.push(["get", id]); return ok({ lab_productid: id }); },
    downloadFile: async (...args) => { calls.push(["download", ...args]); return ok(png); },
  };
  const items = { update: async (...args) => { calls.push(["link", ...args]); return ok(); } };
  const connector = {
    GetProductByBarcode: async barcode => { calls.push(["lookup", barcode]); return ok(catalog); },
    GetProductImage: async url => { calls.push(["image", url]); return ok(Buffer.from(png).toString("base64")); },
  };
  const mocks = {
    "@/generated/services/Lab_productsService": { Lab_productsService: products },
    "@/generated/services/Lab_warehouseitemsService": { Lab_warehouseitemsService: items },
    "@/generated/services/OpenFoodFactsService": { OpenFoodFactsService: connector },
  };
  function load(id) {
    if (mocks[id]) return mocks[id];
    assert.ok(id.startsWith("@/utils/"), id);
    const module = { exports: {} };
    const output = ts.transpileModule(readFileSync(path.join(__dirname, "../src", id.slice(2) + ".ts"), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(output, { module, exports: module.exports, require: load, Error, Date, console, File, Blob, Uint8Array, atob, btoa });
    return module.exports;
  }
  return { data: load("@/utils/ProductData"), products, items, connector, calls };
}

test("typed barcode lookup preserves the requested barcode and uses only the generated connector", async () => {
  const s = setup();
  const found = await s.data.lookupProduct(" 3017620422003 ");
  assert.equal(found.barcode, preview.barcode);
  assert.equal(found.product, catalog);
  assert.deepEqual(s.calls, [["lookup", preview.barcode]]);
  await assert.rejects(s.data.lookupProduct(" "), /Enter a barcode/);
});

test("unknown barcode and other server errors keep their exact distinct messages", async () => {
  const s = setup();
  for (const message of ["No product found for this barcode", "Too many requests", "Permission denied"]) {
    s.connector.GetProductByBarcode = async () => ({ success: false, error: { message: JSON.stringify({ message }) } });
    await assert.rejects(s.data.lookupProduct("123"), error => error.message === message);
  }
});

test("existing EAN reuses its Product with no duplicate create", async () => {
  const s = setup();
  s.products.getAll = async options => {
    assert.equal(options.filter, "lab_ean eq '3017620422003'");
    return ok([{ lab_productid: "existing" }]);
  };
  assert.equal(await s.data.ensureProduct(preview), "existing");
  assert.equal(s.calls.length, 0);
});

test("EAN filter escapes apostrophes rather than altering the query", async () => {
  const s = setup();
  await s.data.ensureProduct({ barcode: "12'34", product: {} });
  assert.equal(s.calls[0][1].filter, "lab_ean eq '12''34'");
  assert.equal(s.calls[1][1].lab_name, "12'34");
});

test("new Product payload follows exact names, text quantity and timestamp without ownership/state defaults", async () => {
  const s = setup();
  assert.equal(await s.data.ensureProduct(preview), "new-product");
  const payload = s.calls.find(call => call[0] === "create")[1];
  assert.deepEqual(Object.keys(payload).sort(), ["lab_brand", "lab_ean", "lab_imageurl", "lab_lastsyncedon", "lab_name", "lab_quantity"]);
  assert.equal(payload.lab_name, "Nutella");
  assert.equal(payload.lab_ean, preview.barcode);
  assert.equal(payload.lab_quantity, "400 g e");
  assert.ok(Math.abs(Date.now() - Date.parse(payload.lab_lastsyncedon)) < 1000);
});

test("create host with no returned ID is resolved by EAN, not a guessed ID", async () => {
  const s = setup();
  let queries = 0;
  s.products.getAll = async () => ok(++queries === 1 ? [] : [{ lab_productid: "resolved" }]);
  s.products.create = async () => ok();
  assert.equal(await s.data.ensureProduct(preview), "resolved");
  assert.equal(queries, 2);
  s.products.getAll = async () => ok([]);
  await assert.rejects(s.data.ensureProduct(preview), /created Product could not be found/);
});

test("link order is find/create, Item lookup, image fetch, generated File upload", async () => {
  const s = setup();
  const result = await s.data.linkProduct("item-id", preview);
  assert.equal(result.productId, "new-product");
  assert.equal(result.imageError, undefined);
  assert.deepEqual(s.calls.map(call => call[0]), ["find", "create", "link", "image", "upload"]);
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls[2])), ["link", "item-id", { "lab_productid@odata.bind": "/lab_products(new-product)" }]);
  const upload = s.calls[4];
  assert.equal(upload[1], "new-product");
  assert.equal(upload[2], "lab_productimage");
  assert.equal(upload[3].type, "image/png");
  assert.equal(upload[3].name, "product.png");
  assert.deepEqual(new Uint8Array(await upload[3].arrayBuffer()), png);
});

test("failed Product query/create or Item update prevents later operations", async () => {
  for (const stage of ["find", "create", "link"]) {
    const s = setup();
    const fail = async () => { throw new Error(stage + " failed"); };
    if (stage === "find") s.products.getAll = fail;
    if (stage === "create") s.products.create = fail;
    if (stage === "link") s.items.update = fail;
    await assert.rejects(s.data.linkProduct("item-id", preview), new RegExp(stage + " failed"));
    assert.equal(s.calls.some(call => call[0] === "image" || call[0] === "upload"), false);
  }
});

test("image download/upload failures retain successful link and report exact server detail", async () => {
  for (const stage of ["image", "upload"]) {
    const s = setup();
    const fail = async () => ({ success: false, error: { message: "Image access denied" } });
    if (stage === "image") s.connector.GetProductImage = fail;
    else s.products.upload = fail;
    const result = await s.data.linkProduct("item-id", preview);
    assert.equal(result.productId, "new-product");
    assert.equal(result.imageError, "Image access denied");
    assert.ok(s.calls.some(call => call[0] === "link"));
    assert.equal(s.calls.filter(call => call[0] === "link").length, 1);
  }
});

test("catalog without an image still links successfully without upload", async () => {
  const s = setup();
  const result = await s.data.linkProduct("item", { barcode: "123", product: {} });
  assert.equal(result.imageError, undefined);
  assert.deepEqual(s.calls.map(call => call[0]), ["find", "create", "link"]);
});

test("PNG and JPEG binary representations become CSP-safe data URLs", async () => {
  const s = setup();
  for (const [bytes, mime] of [[png, "image/png"], [jpeg, "image/jpeg"]]) {
    const base64 = Buffer.from(bytes).toString("base64");
    for (const input of [bytes, base64, { $content: base64 }, new Blob([bytes])]) {
      const image = await s.data.decodeImage(input);
      assert.equal(image.mimeType, mime);
      assert.equal(image.dataUrl, `data:${mime};base64,${base64}`);
    }
  }
});

test("invalid images produce explicit errors instead of empty success", async () => {
  const s = setup();
  for (const input of [null, {}, "", "not base64!", btoa("<html>Error</html>")]) {
    await assert.rejects(s.data.decodeImage(input));
  }
});

test("item detail loads stored File bytes and uses connector only for a product without a stored File", async () => {
  const s = setup();
  await s.data.getProductImage("id", "file-id", catalog.imageUrl);
  assert.deepEqual(s.calls[0], ["download", "id", "lab_productimage"]);
  assert.equal(s.calls.length, 1);
  await s.data.getProductImage("id", undefined, catalog.imageUrl);
  assert.deepEqual(s.calls[1], ["image", catalog.imageUrl]);
  assert.equal(await s.data.getProductImage("id"), null);
});
