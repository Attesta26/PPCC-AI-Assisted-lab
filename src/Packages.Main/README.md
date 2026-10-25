# Warehouse reference data

This Configuration Migration package contains the fixed-GUID reference records
from the data-model specification, extended with the Product records from Lab 5:
2 locations, 2 products, 5 items and 2 historical transactions.

`Data/data_schema.xml` orders dependency tables before their consumers and sets
`disableplugins="true"` on each table. Historical transactions must not change the
seeded stock quantities. Reimporting uses the same record IDs rather than creating
duplicates; it also resets these seed records to their authored values.

The TALXIS package build discovers `Data/` and produces a CMT archive without
an additional project reference. The archive travels with `Packages.Main`; the
Dataverse solutions must be installed before importing the data.

The transaction dates are omitted as the reference-data specification directs.
Dataverse business-required fields are not server-required during import.
Product Image File bytes are not seeded; the two food items link to catalog
Products with image URLs.

Validate the records, relationships and values against the design specifications:

```sh
python3 -m unittest discover -s src/Packages.Main/tests -v
```
