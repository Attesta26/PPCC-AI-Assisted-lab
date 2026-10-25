const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.join(__dirname, "..");
function load(relative, mocks) {
  const module = { exports: {} };
  const output = ts.transpileModule(readFileSync(path.join(root, relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    module, exports: module.exports, Uint8Array,
    require: id => {
      assert.ok(id in mocks, `Unexpected dependency: ${id}`);
      return mocks[id];
    },
  });
  return module.exports;
}

function service(name, client) {
  return load(`src/generated/services/${name}Service.ts`, {
    "@microsoft/power-apps/data": { getClient: () => client },
    "../../../.power/schemas/appschemas/dataSourcesInfo": { dataSourcesInfo: {} },
  })[`${name}Service`];
}

test("OpenFoodFacts typed operations dispatch through the SDK using the stable alias", async () => {
  const calls = [];
  const response = { success: true, data: { name: "Nutella" } };
  const api = service("OpenFoodFacts", { executeAsync: async request => {
    calls.push(JSON.parse(JSON.stringify(request)));
    return response;
  } });
  assert.equal(await api.GetProductByBarcode("3017620422003"), response);
  assert.equal(await api.GetProductImage("https://images.openfoodfacts.org/image.jpg"), response);
  assert.deepEqual(calls, [
    { connectorOperation: { tableName: "OpenFoodFacts", operationName: "GetProductByBarcode", parameters: { barcode: "3017620422003" } } },
    { connectorOperation: { tableName: "OpenFoodFacts", operationName: "GetProductImage", parameters: { imageUrl: "https://images.openfoodfacts.org/image.jpg" } } },
  ]);
});

test("connector errors are not converted to success or replaced by the generated service", async () => {
  const failure = { success: false, error: { message: "No product found for this barcode" } };
  const api = service("OpenFoodFacts", { executeAsync: async () => failure });
  assert.equal(await api.GetProductByBarcode("unknown"), failure);
  const error = new Error("Service unavailable");
  const throwing = service("OpenFoodFacts", { executeAsync: async () => { throw error; } });
  await assert.rejects(throwing.GetProductImage("image"), value => value === error);
});

test("generated Product service uploads bytes to the exact File column", async () => {
  let call;
  const result = { success: true };
  const api = service("Lab_products", { uploadFileToRecord: async (...args) => {
    call = args;
    return result;
  } });
  assert.equal(await api.upload("product-id", "lab_productimage", {
    name: "nutella.jpg", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }), result);
  assert.deepEqual(call.slice(0, 4), ["lab_products", "product-id", "lab_productimage", "nutella.jpg"]);
  assert.deepEqual(Array.from(call[4]), [1, 2, 3]);
});

test("connection binding, operation metadata, and generated models agree", () => {
  const config = JSON.parse(readFileSync(path.join(root, "power.config.json"), "utf8"));
  const refs = Object.values(config.connectionReferences);
  assert.equal(refs.filter(ref => ref.dataSources.includes("OpenFoodFacts")).length, 1);
  assert.match(refs.find(ref => ref.dataSources.includes("OpenFoodFacts")).id, /\/apis\/shared_lab-/);
  assert.equal(config.databaseReferences["default.cds"].dataSources.products.logicalName, "lab_product");
  const { dataSourcesInfo } = load(".power/schemas/appschemas/dataSourcesInfo.ts", {});
  assert.equal(dataSourcesInfo.lab_products.primaryKey, "lab_productid");
  for (const operation of ["GetProductByBarcode", "GetProductImage"]) {
    const api = dataSourcesInfo.OpenFoodFacts.apis[operation];
    assert.equal(api.method, "GET");
    assert.match(api.path, /^\/\{connectionId\}\//);
    assert.ok(api.parameters.some(p => p.name === "connectionId" && p.required));
  }
  assert.equal(dataSourcesInfo.OpenFoodFacts.apis.GetProductImage.responseInfo["200"].type, "file");
  const item = readFileSync(path.join(root, "src/generated/models/Lab_warehouseitemsModel.ts"), "utf8");
  assert.match(item, /"lab_productid@odata.bind"\?: string/);
  assert.match(item, /_lab_productid_value\?: string/);
  assert.equal(existsSync(path.join(root, "src/generated/services/capitalizedentitylogicalnameexamplesService.ts")), false);
  const schema = readFileSync(path.join(root, ".power/schemas/lab-5fopen-20food-20facts-5f2d8bb7bb972ef5dd/lab_5fopen_20food_20facts_5f2d8bb7bb972ef5dd.Schema.json"), "utf8");
  assert.doesNotMatch(schema, /[?&]sig=|scriptDefinitionUrl|apiDefinitions/);
});
