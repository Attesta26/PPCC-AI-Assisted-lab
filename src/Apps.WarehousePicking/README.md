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
Stock-count screens are not included.

## Barcode lookup

On an item's detail, select **Scan Barcode** (or **Rescan Barcode** for a linked
item). The dialog tries the back camera with `@zxing/browser`; manual barcode input
and **Look Up** remain available when the camera is absent or permission is denied.
Both paths use the same connector operation. A new lookup replaces the old preview,
and late responses cannot link a product to a different typed barcode.

The preview shows the catalog name, brand, quantity and image. **Link to Item**
finds a Product by EAN (or creates it), saves the Item's Product lookup, then
uploads the image through the generated Product File service. These are separate
operations: an image error leaves the Product and link intact and displays a
persistent warning. There is no EAN alternate key, so this is find-then-create,
not an atomic concurrent upsert.

The item detail displays its linked Product and stored image. For catalog records
without a stored File, the image is loaded through the connector. External image
URLs are never loaded directly by the browser; verified PNG/JPEG bytes are rendered
as CSP-safe data URLs. No stock comparisons or direct Dataverse/API calls were
added.

Neither warehouse role has Product privileges, as specified. Live Product reads,
creates, links and File uploads require a user with suitable existing privileges
(the lab's System Administrator acceptance-test account); the app does not elevate
access.

## Data and validation

The four generated Dataverse services in `src/generated/services` are the only
Dataverse data-access layer. Product and the optional Item Product lookup are
registered in `power.config.json`.

Generate table models with `pp-app-code-data` from `../Solutions.DataModel`.
For Product, follow this with `pa app add data-source --connector dataverse
--table lab_product --environment-id <Dev environment ID>` to generate the
File-column upload/download methods from the deployed schema. The offline
template does not generate those methods.

The deployed Open Food Facts connector is bound to a per-environment connection
using `pa connection create` and `pa app add data-source`. Both commands need
`--environment-id` when binding to a different environment. CP12 sets this app's
`environmentId` to the Dev environment returned by `txc env list`, enabling the
Power Apps Local Play link from `npm run dev`. Discover the connector
ID with `pa connector list --search "Open Food Facts" --json`; its API name is
different from its Dataverse schema name.

The generated `OpenFoodFactsService` exposes `GetProductByBarcode` and
`GetProductImage`. After regeneration, retain the spec's `OpenFoodFacts` alias in
the service, `dataSourcesInfo.ts`, and the matching connection reference's
`dataSources` list. `pa` otherwise uses an environment-specific escaped name.
Do not change the generated operation paths or remove their connection ID parameter.
If the offline Item refresh leaves `capitalizedentitylogicalnameexamplesService.ts`,
finish its rename to `Lab_warehouseitemsService.ts` and remove its duplicate barrel
export; it is a template rename collision, not a second service.
Before committing a generated connector schema, remove temporary signed download
URLs (`apiDefinitions` and `scriptDefinitionUrl`) and creator metadata. They are
not required by the app and must not be shipped in source control.

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

The Node tests cover generated SDK dispatch, create/reuse/link/upload ordering,
partial image failure, exact connector errors, camera/manual dialog paths, stale
lookup responses and camera cleanup. They mock platform services and camera
hardware; browser permissions, CSP and a live end-to-end lookup still need an
authenticated app session after deployment.

From the repository root, `dotnet build WarehouseManagement.slnx` builds and packages
the app with the other projects. Local Power Apps data access requires the user's
own authenticated development session.

The Grid uses AG Grid Enterprise through TALXIS base controls. Without a license,
it displays the library's trial notice and watermark.
