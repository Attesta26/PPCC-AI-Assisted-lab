# Warehouse Picking

Power Apps code app for warehouse workers, scaffolded with the TALXIS `pp-app-code`
starter. It ships through `Solutions.UI` alongside the manager's model-driven app.

## Screens

- **Items** is the landing page. Select an item to see its quantity, category,
  location and newest-first transaction history. Use **New Transaction** to pick
  (Outbound) or receive (Inbound). **New Item** creates an inventory item.
- **Transactions** lists every movement, newest first, and lets you record a
  transaction for any item.
- **Locations** shows locations with item counts and a **New Location** dialog.

Desktop lists use TALXIS Grid; phone-sized screens show the same records as cards
with bottom navigation. Forms and lookups use TALXIS base controls on Fluent UI.
An item's existing quantity is read-only: stock movements go through transactions.
Barcode scanning and stock-count screens are intentionally not included in CP09.

## Data and validation

The three generated services in `src/generated/services` are the only Dataverse
data-access layer. Regenerate them with `pp-app-code-data` from
`../Solutions.DataModel`; do not edit generated files.

`src/utils/WarehouseData.ts` handles pagination, create payloads and item updates.
It omits ownership/state fields that Dataverse supplies automatically, despite the
generated create signatures requiring them. The forms check required fields, not
stock levels or quantity ranges. Server error text is shown unchanged in the form
and toast; failed saves keep the entered values.

Successful mutations invalidate the query cache. The item quantity and transaction
history are re-read from the server, never adjusted optimistically. Creating a
location still requires the caller's existing privileges; this app does not broaden
the Warehouse worker role. The UI specification's live checks use System Administrator.

## Commands

From this folder:

```sh
npm run dev        # http://localhost:5173
npm test
npm run lint
npm run build
```

From the repository root, `dotnet build WarehouseManagement.slnx` builds and packages
the app with the other projects. Local Power Apps data access requires the user's
own authenticated development session.

The Grid uses AG Grid Enterprise through TALXIS base controls. Without a license,
it displays the library's trial notice and watermark.
