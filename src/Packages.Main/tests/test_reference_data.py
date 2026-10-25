import re
import unittest
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "src/Packages.Main/Data"


def spec_rows(filename):
    text = (ROOT / "docs/design" / filename).read_text()
    return [
        [cell.strip().strip("`") for cell in line.strip("|").split("|")]
        for line in text.splitlines()
        if re.match(r"^\| `[0-9a-f-]{36}` \|", line)
    ]


class ReferenceDataTests(unittest.TestCase):
    def setUp(self):
        self.schema = ET.parse(DATA / "data_schema.xml").getroot()
        self.data = ET.parse(DATA / "data.xml").getroot()
        self.records = {
            entity.get("name"): {
                record.get("id"): {
                    field.get("name"): field.get("value")
                    for field in record.findall("field")
                }
                for record in entity.findall("./records/record")
            }
            for entity in self.data
        }

    def test_dependency_order_and_disabled_plugins(self):
        expected = [
            "lab_warehouselocation", "lab_product",
            "lab_warehouseitem", "lab_warehousetransaction",
        ]
        self.assertEqual([entity.get("name") for entity in self.schema], expected)
        self.assertEqual([entity.get("name") for entity in self.data], expected)
        for entity in self.schema:
            self.assertEqual(entity.get("disableplugins"), "true")
            fields = entity.findall("./fields/field")
            primary = [field for field in fields if field.get("primaryKey") == "true"]
            self.assertEqual(len(primary), 1)
            self.assertEqual(primary[0].get("name"), entity.get("primaryidfield"))

    def test_every_record_and_value_matches_spec(self):
        names = {
            record["lab_name"]: identifier
            for records in self.records.values()
            for identifier, record in records.items()
        }
        expected = {}
        for row in spec_rows("lab-1-data-model.md"):
            identifier, name, *values = row
            fields = {"lab_name": name}
            if len(row) == 5:
                entity = "lab_warehouselocation"
                columns = ["address", "capacity", "isactive"]
            elif len(row) == 9:
                entity = "lab_warehouseitem"
                columns = [
                    "sku", "availablequantity", "category", "isperishable",
                    "unitprice", "reorderpoint", "locationid",
                ]
                values[-1] = names[values[-1]]
            else:
                entity = "lab_warehousetransaction"
                columns = ["itemid", "quantity", "transactiontype", "referencenumber"]
                values[0] = names[values[0]]
                values[2] = values[2].split()[0]
            fields.update({f"lab_{column}": value for column, value in zip(columns, values)})
            fields[f"{entity}id"] = identifier
            expected[identifier] = fields

        for row in spec_rows("lab-5-external-data-and-background-processing.md"):
            identifier, name, ean, brand, quantity, image, synced = row
            expected[identifier] = {
                "lab_productid": identifier, "lab_name": name, "lab_ean": ean,
                "lab_brand": brand, "lab_quantity": quantity,
                "lab_imageurl": image, "lab_lastsyncedon": synced,
            }
        expected["0552ebd4-dbf7-47ed-bf92-fae96f36fe7c"]["lab_productid"] = names["Nutella"]
        expected["cbe58fd5-4622-418d-ac8b-04d8041c8c65"]["lab_productid"] = names["Coca-Cola"]
        actual = {
            identifier: record
            for records in self.records.values()
            for identifier, record in records.items()
        }
        self.assertEqual(len(actual), 11)
        self.assertEqual(actual, expected)

    def test_fields_ids_and_lookups_are_consistent(self):
        for entity in self.schema:
            entity_name = entity.get("name")
            fields = {field.get("name"): field for field in entity.findall("./fields/field")}
            for identifier, record in self.records[entity_name].items():
                uuid.UUID(identifier)
                self.assertEqual(record[entity.get("primaryidfield")], identifier)
                self.assertEqual(set(record) - fields.keys(), set())
                for name, field in fields.items():
                    if name in record and field.get("type") == "entityreference":
                        target = field.get("lookupType")
                        self.assertIn(record[name], self.records[target])
        for entity in self.data:
            schema = self.schema.find(f"./entity[@name='{entity.get('name')}']")
            for field in entity.findall("./records/record/field[@lookupentity]"):
                definition = schema.find(f"./fields/field[@name='{field.get('name')}']")
                self.assertEqual(field.get("lookupentity"), definition.get("lookupType"))

    def test_content_types_manifest(self):
        manifest = ET.parse(DATA / "[Content_Types].xml").getroot()
        entry = manifest.find("{http://schemas.openxmlformats.org/package/2006/content-types}Default")
        self.assertEqual(entry.get("Extension"), "xml")
        self.assertEqual(entry.get("ContentType"), "application/octet-stream")


if __name__ == "__main__":
    unittest.main()
