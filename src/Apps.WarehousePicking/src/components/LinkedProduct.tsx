import { useQuery } from "@tanstack/react-query";
import { Body1, Card, MessageBar, MessageBarBody, Spinner, Subtitle2 } from "@fluentui/react-components";
import { getProduct, getProductImage } from "@/utils/ProductData";
import { errorText } from "@/utils/ServicePayload";

export function LinkedProduct({ productId }: { productId: string }) {
  const product = useQuery({ queryKey: ["product", productId], queryFn: () => getProduct(productId) });
  const record = product.data;
  const image = useQuery({
    queryKey: ["productImage", productId, record?.lab_productimage, record?.lab_imageurl],
    queryFn: () => getProductImage(productId, record?.lab_productimage, record?.lab_imageurl),
    enabled: !!record,
  });
  return <Card>
    <Subtitle2>Linked Product</Subtitle2>
    {product.isLoading && <Spinner size="tiny" />}
    {product.error && <MessageBar intent="error"><MessageBarBody>{errorText(product.error)}</MessageBarBody></MessageBar>}
    {record && <>
      <Subtitle2>{record.lab_name}</Subtitle2>
      <Body1>{[record.lab_brand, record.lab_quantity, record.lab_ean].filter(Boolean).join(" - ")}</Body1>
    </>}
    {image.data && <img src={image.data.dataUrl} alt={record?.lab_name ?? "Product"}
      width={160} height={160} style={{ objectFit: "contain" }} />}
    {image.error && <MessageBar intent="warning"><MessageBarBody>{errorText(image.error)}</MessageBarBody></MessageBar>}
  </Card>;
}
