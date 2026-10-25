import type { Product } from "@/generated/models/OpenFoodFactsModel";
import { Lab_productsService } from "@/generated/services/Lab_productsService";
import { Lab_warehouseitemsService } from "@/generated/services/Lab_warehouseitemsService";
import { OpenFoodFactsService } from "@/generated/services/OpenFoodFactsService";
import { errorText, serviceData, serviceResult } from "@/utils/ServicePayload";

export type ProductPreview = { barcode: string; product: Product };
export type ProductImage = { bytes: Uint8Array; mimeType: "image/png" | "image/jpeg"; dataUrl: string };

export async function lookupProduct(barcode: string): Promise<ProductPreview> {
  const value = barcode.trim();
  if (!value) throw new Error("Enter a barcode.");
  return { barcode: value, product: await serviceData(OpenFoodFactsService.GetProductByBarcode(value)) };
}

export async function decodeImage(data: unknown): Promise<ProductImage> {
  let bytes: Uint8Array;
  if (data instanceof Uint8Array) {
    bytes = data;
  } else if (data instanceof Blob) {
    bytes = new Uint8Array(await data.arrayBuffer());
  } else {
    const content = data && typeof data === "object" && "$content" in data ? data.$content : data;
    if (typeof content !== "string") throw new Error("The image service returned invalid image data.");
    const binary = atob(content);
    bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  const mimeType = png.every((value, i) => bytes[i] === value) ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" : undefined;
  if (!mimeType) throw new Error("The image service did not return a PNG or JPEG image.");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { bytes, mimeType, dataUrl: `data:${mimeType};base64,${btoa(binary)}` };
}

export const getCatalogImage = async (url: string) =>
  decodeImage(await serviceData(OpenFoodFactsService.GetProductImage(url)));

export const getProduct = (id: string) => serviceData(Lab_productsService.get(id));

export async function getProductImage(id: string, imageFile?: string, imageUrl?: string) {
  if (imageFile) {
    return decodeImage(await serviceData(Lab_productsService.downloadFile(id, "lab_productimage")));
  }
  return imageUrl ? getCatalogImage(imageUrl) : null;
}

export async function ensureProduct(preview: ProductPreview): Promise<string> {
  const { barcode, product } = preview;
  const query = {
    select: ["lab_productid"],
    filter: `lab_ean eq '${barcode.replace(/'/g, "''")}'`,
    orderBy: ["createdon asc", "lab_productid asc"],
    top: 1,
  };
  const existing = await serviceData(Lab_productsService.getAll(query));
  if (existing[0]?.lab_productid) return existing[0].lab_productid;

  // Dataverse supplies statecode, but the generated create signature marks it required.
  type CreateProduct = Parameters<typeof Lab_productsService.create>[0];
  const payload: Omit<CreateProduct, "statecode"> = {
    lab_name: product.name || barcode,
    lab_ean: barcode,
    lab_brand: product.brand,
    lab_quantity: product.quantity,
    lab_imageurl: product.imageUrl,
    lab_lastsyncedon: new Date().toISOString(),
  };
  const created = await serviceResult(Lab_productsService.create(payload as CreateProduct));
  if (created.data?.lab_productid) return created.data.lab_productid;
  const records = await serviceData(Lab_productsService.getAll(query));
  if (!records[0]?.lab_productid) throw new Error("The created Product could not be found.");
  return records[0].lab_productid;
}

export async function linkProduct(itemId: string, preview: ProductPreview) {
  const productId = await ensureProduct(preview);
  await serviceResult(Lab_warehouseitemsService.update(itemId, {
    "lab_productid@odata.bind": `/lab_products(${productId})`,
  }));

  // The link is committed already. Image errors must never undo or hide that success.
  let imageError: string | undefined;
  if (preview.product.imageUrl) {
    try {
      const image = await getCatalogImage(preview.product.imageUrl);
      const file = new File([new Uint8Array(image.bytes)], image.mimeType === "image/png" ? "product.png" : "product.jpg", {
        type: image.mimeType,
      });
      await serviceResult(Lab_productsService.upload(productId, "lab_productimage", file));
    } catch (error) {
      imageError = errorText(error);
    }
  }
  return { productId, imageError };
}
