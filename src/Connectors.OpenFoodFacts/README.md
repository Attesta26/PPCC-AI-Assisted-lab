# Open Food Facts connector

This no-auth connector is packaged by `Solutions.Connectors`, independently of
`Packages.Main`. Its schema name is `lab_connectorsopenfoodfacts`.

- `GetProductByBarcode` adds the required User-Agent and flattens the catalog
  response into `ean`, `name`, `brand`, `quantity`, and `imageUrl`.
- Unknown products return 404 with `No product found for this barcode`.
- `GetProductImage` returns image bytes and preserves their content type.
  Only HTTPS URLs on `images.openfoodfacts.org` with the default port and no
  user information are accepted, so the connector cannot proxy arbitrary URLs.

Run the custom-code regression checks locally:

```sh
dotnet run --project src/Connectors.OpenFoodFacts/tests/Connector.Tests.csproj
```

The checks compile the actual connector script against a small test-only
`ScriptBase` host. They do not substitute for a deployed-connector runtime test.
