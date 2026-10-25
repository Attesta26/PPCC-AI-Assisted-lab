const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

function loadScripts() {
    const alerts = [];
    const warnings = [];
    const context = vm.createContext({
        console: { warn: (...args) => warnings.push(args) },
        Xrm: {
            WebApi: { retrieveRecord: async () => ({ lab_unitprice: 899 }) },
            Navigation: { openAlertDialog: async options => alerts.push(options) }
        }
    });
    vm.runInContext(readFileSync(`${__dirname}/../build/lab_main.js`, 'utf8'), context);
    return { ...context.WarehouseScripts, xrm: context.Xrm, alerts, warnings };
}

function form(values = {}, formType = 1) {
    const attributes = Object.fromEntries(Object.entries(values).map(([name, value]) => [
        name, { getValue: () => values[name], setValue: next => { values[name] = next; } }
    ]));
    const notifications = [];
    const formContext = {
        getAttribute: name => attributes[name],
        ui: {
            getFormType: () => formType,
            setFormNotification: (...args) => notifications.push(args)
        }
    };
    return { formContext, getFormContext: () => formContext, values, notifications };
}

function record(quantity, reorder, summarization = 'none') {
    let format;
    return {
        getValue: name => name === 'lab_availablequantity' ? quantity : reorder,
        getSummarizationType: () => summarization,
        expressions: { ui: { setCustomFormattingExpression: (name, expression) => {
            assert.equal(name, 'lab_availablequantity');
            format = expression;
        } } },
        formatting: () => format?.()
    };
}

function dataset(records = [], loading = false) {
    const listeners = new Map();
    const interceptors = new Map();
    return {
        loading,
        error: false,
        getRecords: () => records,
        addEventListener: (event, listener) => {
            const callbacks = listeners.get(event) ?? [];
            callbacks.push(listener);
            listeners.set(event, callbacks);
        },
        setInterceptor: (name, interceptor) => interceptors.set(name, interceptor),
        emit: (event, ...args) => listeners.get(event)?.forEach(listener => listener(...args)),
        interceptors
    };
}

test('new transaction receives a date; existing dates and existing records are unchanged', () => {
    const { TransactionForm } = loadScripts();
    const fresh = form({ lab_transactiondate: null });
    const before = Date.now();
    TransactionForm.onLoad(fresh);
    assert.ok(fresh.values.lab_transactiondate.getTime() >= before);
    const date = new Date('2026-01-01');
    const existing = form({ lab_transactiondate: date }, 2);
    TransactionForm.onLoad(existing);
    assert.equal(existing.values.lab_transactiondate, date);
    const missing = form({ lab_transactiondate: null }, 2);
    TransactionForm.onLoad(missing);
    assert.equal(missing.values.lab_transactiondate, null);
});

for (const [quantity, price, expected] of [[2, 899, 1798], [0, 899, 0], [2, 0, 0]]) {
    test(`quantity ${quantity} times price ${price} sets total ${expected}`, async () => {
        const { TransactionForm, xrm } = loadScripts();
        xrm.WebApi.retrieveRecord = async (...args) => {
            assert.deepEqual(args, ['lab_warehouseitem', 'item-id', '?$select=lab_unitprice']);
            return { lab_unitprice: price };
        };
        const context = form({
            lab_quantity: quantity, lab_itemid: [{ id: '{item-id}' }], lab_totalvalue: 77
        });
        await TransactionForm.onQuantityChange(context);
        assert.equal(context.values.lab_totalvalue, expected);
    });
}

for (const response of [{}, { lab_unitprice: null }, new Error('Price unavailable')]) {
    test(`missing or unreadable price leaves the total unchanged: ${String(response)}`, async () => {
        const { TransactionForm, xrm, warnings } = loadScripts();
        xrm.WebApi.retrieveRecord = async () => {
            if (response instanceof Error) throw response;
            return response;
        };
        const context = form({
            lab_quantity: 2, lab_itemid: [{ id: '{item-id}' }], lab_totalvalue: 77
        });
        await TransactionForm.onQuantityChange(context);
        assert.equal(context.values.lab_totalvalue, 77);
        assert.equal(warnings.length, response instanceof Error ? 1 : 0);
    });
}

test('missing item or quantity does not request a price', async () => {
    const { TransactionForm, xrm } = loadScripts();
    xrm.WebApi.retrieveRecord = async () => assert.fail('Unexpected price request');
    for (const [quantity, item] of [[null, [{ id: 'id' }]], [2, null], [2, []]]) {
        const context = form({ lab_quantity: quantity, lab_itemid: item, lab_totalvalue: 77 });
        await TransactionForm.onQuantityChange(context);
        assert.equal(context.values.lab_totalvalue, 77);
    }
});

test('a stale price response cannot overwrite a newer item or quantity selection', async () => {
    const { TransactionForm, xrm } = loadScripts();
    let resolve;
    xrm.WebApi.retrieveRecord = () => new Promise(done => { resolve = done; });
    const context = form({
        lab_quantity: 2, lab_itemid: [{ id: '{item-id}' }], lab_totalvalue: 77
    });
    const pending = TransactionForm.onQuantityChange(context);
    context.values.lab_quantity = 3;
    resolve({ lab_unitprice: 899 });
    await pending;
    assert.equal(context.values.lab_totalvalue, 77);
});

for (const [name, quantity, reorder, expected] of [
    ['Mouse', 5, 10, 'Stock level for Mouse: 5 units.\n⚠ Below reorder point (10). Consider restocking.'],
    ['Mouse', 10, 10, 'Stock level for Mouse: 10 units.\n⚠ Below reorder point (10). Consider restocking.'],
    ['Laptop', 100, 20, 'Stock level for Laptop: 100 units.\n✓ Stock is above reorder point (20).'],
    [null, null, null, 'Stock level for Unknown: 0 units.\n⚠ Below reorder point (0). Consider restocking.']
]) {
    test(`stock alert uses exact text for ${name}, quantity ${quantity}`, async () => {
        const { RibbonActions, alerts } = loadScripts();
        const context = form({ lab_name: name, lab_availablequantity: quantity, lab_reorderpoint: reorder });
        await RibbonActions.checkStockLevels(context.formContext);
        assert.equal(alerts[0].title, 'Stock Check');
        assert.equal(alerts[0].text, expected);
    });
}

test('grid renames quantity and highlights only low-stock item cells, not summaries', () => {
    const { GridApi } = loadScripts();
    const rows = [
        record(5, 10), record(10, 10), record(11, 10), record(10, null),
        record(11, undefined), record(null, 10), record(0, 0),
        record(5, 10, 'grouping'), record(5, 10, 'aggregation')
    ];
    const grid = dataset(rows);
    GridApi.onDatasetControlInitialized({ controlId: 'items', dataset: grid });
    const columns = grid.interceptors.get('columns')([
        { name: 'lab_availablequantity', displayName: 'Quantity' },
        { name: 'lab_name', displayName: 'Name' }
    ]);
    assert.equal(columns[0].displayName, 'Qty on hand');
    assert.equal(columns[1].displayName, 'Name');
    assert.deepEqual(rows.map(row => row.formatting()?.backgroundColor), [
        '#FDE7E9', '#FDE7E9', undefined, '#FDE7E9', undefined,
        undefined, '#FDE7E9', undefined, undefined
    ]);
    const later = record(3, 10);
    grid.emit('onRecordLoaded', later);
    assert.equal(later.formatting().backgroundColor, '#FDE7E9');
});

for (const gridFirst of [true, false]) {
    test(`location notification works with ${gridFirst ? 'grid' : 'form'} initialized first`, async () => {
        const { GridApi, LocationForm } = loadScripts();
        const rows = [record(5, 10), record(100, 20), record(105, null, 'grouping')];
        const grid = dataset(rows);
        const context = form();
        if (gridFirst) GridApi.onDatasetControlInitialized({ controlId: 'items', dataset: grid });
        const pending = LocationForm.onLoad(context);
        if (!gridFirst) GridApi.onDatasetControlInitialized({ controlId: 'items', dataset: grid });
        await pending;
        assert.deepEqual(context.notifications.at(-1), [
            'TALXIS Grid ready — 2 warehouse item(s) loaded', 'INFO', 'talxisgrid'
        ]);
    });
}

test('empty loaded grid reports zero, loading waits, and failed datasets do not report success', async () => {
    const { GridApi, LocationForm } = loadScripts();
    const grid = dataset([], true);
    GridApi.onDatasetControlInitialized({ controlId: 'items', dataset: grid });
    const context = form();
    await LocationForm.onLoad(context);
    assert.equal(context.notifications.length, 0);
    grid.loading = false;
    grid.emit('onFirstDataLoaded');
    assert.equal(context.notifications.at(-1)[0], 'TALXIS Grid ready — 0 warehouse item(s) loaded');
    grid.error = true;
    grid.emit('onLoading', false);
    assert.equal(context.notifications.length, 1);
});

test('destroyed grid is removed from the initialization bridge', async () => {
    const { GridApi } = loadScripts();
    const grid = dataset();
    GridApi.onDatasetControlInitialized({ controlId: 'items', dataset: grid });
    assert.equal(await GridApi.getDataset('items'), grid);
    grid.emit('onDestroyed');
    const next = GridApi.getDataset('items');
    const replacement = dataset();
    GridApi.onDatasetControlInitialized({ controlId: 'items', dataset: replacement });
    assert.equal(await next, replacement);
});
