const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function load(relative, mocks, globals = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(readFileSync(path.join(__dirname, "../src", relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, Error, console, ...globals, require: id => {
    assert.ok(id in mocks, `Unexpected dependency: ${id}`);
    return mocks[id];
  } });
  return module.exports;
}

function ui() {
  const state = [];
  let cursor = 0;
  const effects = [];
  const notifications = [];
  const calls = [];
  let camera;
  let closed = 0;
  const data = {
    lookupProduct: async barcode => { calls.push(["lookup", barcode]); return { barcode, product: { name: "Nutella" } }; },
    getCatalogImage: async () => ({ dataUrl: "data:image/png;base64,image" }),
    linkProduct: async (...args) => { calls.push(["link", ...args]); return { productId: "product" }; },
  };
  const element = (type, props) => ({ type, props });
  const fluent = new Proxy({ makeStyles: () => () => ({}), tokens: {} }, { get: (target, key) => target[key] ?? key });
  const { BarcodeScanDialog } = load("components/BarcodeScanDialog.tsx", {
    "react": {
      useState: initial => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], value => { state[index] = value; }];
      },
      useRef: initial => {
        const index = cursor++;
        return state[index] ?? (state[index] = { current: initial });
      },
      useEffect: (effect, deps) => { effects.push({ effect, deps }); },
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "Fragment" },
    "@fluentui/react-components": fluent,
    "@talxis/base-controls": { TextField: "TextField", usePcfContext: () => ({}) },
    "@/hooks/UseBarcodeCamera": { useBarcodeCamera: (...args) => { camera = args[2]; } },
    "@/hooks/use-toast": { useToast: () => ({
      success: text => notifications.push(["success", text]),
      warning: text => notifications.push(["warning", text]),
    }) },
    "@/utils/ProductData": data,
    "@/utils/ServicePayload": { errorText: reason => reason.message },
  });
  const outer = BarcodeScanDialog({ itemId: "item", onLinked: async () => {} });
  outer.props.children[0].props.onClick();
  cursor = 0;
  const opened = BarcodeScanDialog({ itemId: "item", onLinked: async () => {} });
  const ScanDialog = opened.props.children[1].type;
  state.length = 0;
  const props = { itemId: "item", onLinked: async () => calls.push(["refresh"]), onClose: () => closed++ };
  const render = () => { cursor = 0; effects.length = 0; return ScanDialog(props); };
  function find(node, predicate) {
    if (!node || typeof node !== "object") return;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = find(child, predicate);
      if (found) return found;
    }
  }
  const byId = (tree, id) => find(tree, node => node.props?.["data-testid"] === id);
  return { data, calls, notifications, render, find, byId, effects, get camera() { return camera; }, get closed() { return closed; } };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("scan/rescan button follows the current product link", () => {
  const s = ui();
  assert.ok(s.byId(s.render(), "scan-lookup-button"));
  const source = readFileSync(path.join(__dirname, "../src/components/BarcodeScanDialog.tsx"), "utf8");
  assert.match(source, /currentProductId \? "Rescan Barcode" : "Scan Barcode"/);
});

test("typed and camera barcodes follow the same lookup and preview path", async () => {
  for (const mode of ["typed", "camera"]) {
    const s = ui();
    let tree = s.render();
    if (mode === "camera") {
      s.camera("3017620422003");
    } else {
      const input = s.find(tree, node => node.type === "TextField");
      input.props.onOverrideComponentProps({}).onChange({}, "3017620422003");
      tree = s.render();
      s.byId(tree, "scan-lookup-button").props.onClick();
    }
    await settle();
    tree = s.render();
    assert.equal(s.byId(tree, "scan-product-name").props.children, "Nutella");
    assert.deepEqual(s.calls, [["lookup", "3017620422003"]]);
    s.byId(tree, "scan-link-button").props.onClick();
    await settle();
    assert.equal(s.calls[1][0], "link");
    assert.equal(s.calls[1][1], "item");
    assert.equal(s.calls[1][2].barcode, "3017620422003");
    assert.equal(s.calls[2][0], "refresh");
    assert.equal(s.closed, 1);
  }
});

test("changing the barcode discards a late lookup response and prevents linking the wrong product", async () => {
  const s = ui();
  let resolve;
  s.data.lookupProduct = () => new Promise(done => { resolve = done; });
  s.render();
  s.camera("old");
  const tree = s.render();
  s.find(tree, node => node.type === "TextField").props.onOverrideComponentProps({}).onChange({}, "new");
  resolve({ barcode: "old", product: { name: "Wrong product" } });
  await settle();
  assert.equal(s.byId(s.render(), "scan-product-name"), undefined);
  assert.equal(s.byId(s.render(), "scan-link-button").props.disabled, true);
});

test("image-save failure remains a linked success with persistent warning and no duplicate link", async () => {
  const s = ui();
  s.data.linkProduct = async () => ({ productId: "product", imageError: "Image denied" });
  s.render();
  s.camera("123");
  await settle();
  s.byId(s.render(), "scan-link-button").props.onClick();
  await settle();
  const tree = s.render();
  assert.equal(s.closed, 0);
  assert.equal(s.byId(tree, "scan-link-button").props.disabled, true);
  assert.ok(s.notifications.some(([intent, text]) => intent === "warning" && text.includes("image failed to save: Image denied")));
  assert.ok(s.find(tree, node => node.type === "MessageBarBody" && node.props.children.includes("image failed to save")));
});

test("unknown barcode is shown unchanged and manual input stays available", async () => {
  const s = ui();
  s.data.lookupProduct = async () => { throw new Error("No product found for this barcode"); };
  s.render();
  s.camera("000");
  await settle();
  const tree = s.render();
  assert.ok(s.find(tree, node => node.type === "MessageBarBody" && node.props.children === "No product found for this barcode"));
  assert.ok(s.find(tree, node => node.type === "TextField"));
});

test("camera stops after one decode and also cleans up late camera startup after unmount", async () => {
  for (const earlyDecode of [true, false]) {
    let effect;
    let callback;
    let complete;
    let stops = 0;
    let tracks = 0;
    const detected = [];
    const controls = { stop: () => stops++ };
    class Stream { getTracks() { return [{ stop: () => tracks++ }]; } }
    const video = { srcObject: new Stream() };
    const hook = load("hooks/UseBarcodeCamera.ts", {
      "react": { useRef: current => ({ current }), useState: () => [undefined, () => {}], useEffect: fn => { effect = fn; } },
      "@zxing/browser": { BrowserMultiFormatReader: class {
        decodeFromConstraints(constraints, element, cb) {
          assert.equal(constraints.video.facingMode.ideal, "environment");
          assert.equal(element, video);
          callback = cb;
          return new Promise(resolve => { complete = resolve; });
        }
      } },
      "@/utils/ServicePayload": { errorText: error => error.message },
    }, { MediaStream: Stream });
    hook.useBarcodeCamera(video, true, value => detected.push(value));
    const cleanup = effect();
    if (earlyDecode) {
      callback({ getText: () => "12345678" }, undefined, controls);
      callback({ getText: () => "87654321" }, undefined, controls);
      assert.deepEqual(detected, ["12345678"]);
    }
    cleanup();
    complete(controls);
    await settle();
    assert.ok(stops >= 1);
    assert.equal(tracks, 1);
    assert.equal(video.srcObject, null);
  }
});
