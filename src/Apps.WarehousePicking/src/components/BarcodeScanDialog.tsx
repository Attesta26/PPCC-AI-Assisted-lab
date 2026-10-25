import { useEffect, useRef, useState } from "react";
import {
  Body1, Button, Card, Dialog, DialogActions, DialogBody, DialogContent,
  DialogSurface, DialogTitle, Field, MessageBar, MessageBarBody, Spinner,
  Subtitle2, makeStyles, tokens,
} from "@fluentui/react-components";
import { TextField, usePcfContext } from "@talxis/base-controls";
import { useBarcodeCamera } from "@/hooks/UseBarcodeCamera";
import { useToast } from "@/hooks/use-toast";
import { getCatalogImage, linkProduct, lookupProduct, type ProductPreview } from "@/utils/ProductData";
import { errorText } from "@/utils/ServicePayload";

const useStyles = makeStyles({
  content: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  video: { width: "100%", maxHeight: "220px", backgroundColor: tokens.colorNeutralBackground3 },
  image: { maxWidth: "160px", maxHeight: "160px", objectFit: "contain" },
  row: { display: "flex", gap: tokens.spacingHorizontalM, alignItems: "center" },
  input: { flexGrow: 1 },
});

type Props = { itemId: string; currentProductId?: string; onLinked: () => Promise<void> };

export function BarcodeScanDialog({ itemId, currentProductId, onLinked }: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <Button onClick={() => setOpen(true)} data-testid="scan-barcode-button">
      {currentProductId ? "Rescan Barcode" : "Scan Barcode"}
    </Button>
    {open && <ScanDialog itemId={itemId} onLinked={onLinked} onClose={() => setOpen(false)} />}
  </>;
}

function ScanDialog({ itemId, onLinked, onClose }: Omit<Props, "currentProductId"> & { onClose: () => void }) {
  const styles = useStyles();
  const toast = useToast();
  const context = usePcfContext();
  const [barcode, setBarcode] = useState("");
  const [preview, setPreview] = useState<ProductPreview>();
  const [image, setImage] = useState<string>();
  const [error, setError] = useState<string>();
  const [imageError, setImageError] = useState<string>();
  const [looking, setLooking] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const request = useRef(0);
  const busy = useRef(false);
  const mounted = useRef(true);
  const cameraAccepted = useRef(false);
  useEffect(() => () => { mounted.current = false; request.current++; }, []);

  async function lookUp(value: string) {
    if (busy.current) return;
    const ticket = ++request.current;
    setLooking(true);
    setPreview(undefined);
    setImage(undefined);
    setImageError(undefined);
    setError(undefined);
    try {
      const found = await lookupProduct(value);
      if (!mounted.current || ticket !== request.current) return;
      setPreview(found);
    } catch (reason) {
      if (mounted.current && ticket === request.current) setError(errorText(reason));
    } finally {
      if (mounted.current && ticket === request.current) setLooking(false);
    }
  }

  useEffect(() => {
    if (!preview?.product.imageUrl) return;
    let cancelled = false;
    getCatalogImage(preview.product.imageUrl).then(result => {
      if (!cancelled) setImage(result.dataUrl);
    }).catch(reason => {
      if (!cancelled) setImageError(errorText(reason));
    });
    return () => { cancelled = true; };
  }, [preview]);

  const cameraError = useBarcodeCamera(video, !barcode && !looking && !preview && !linking && !linked, value => {
    if (cameraAccepted.current) return;
    cameraAccepted.current = true;
    setBarcode(value);
    void lookUp(value);
  });

  function changeBarcode(value: string) {
    request.current++;
    cameraAccepted.current = true;
    setBarcode(value);
    setPreview(undefined);
    setImage(undefined);
    setImageError(undefined);
    setError(undefined);
    setLooking(false);
  }

  async function link() {
    if (!preview || busy.current) return;
    busy.current = true;
    setLinking(true);
    setError(undefined);
    try {
      const result = await linkProduct(itemId, preview);
      setLinked(true);
      if (result.imageError) {
        setImageError(`Product linked, but its image failed to save: ${result.imageError}`);
        toast.warning(`Product linked, but its image failed to save: ${result.imageError}`);
      } else {
        toast.success("Product linked to item");
      }
      try {
        await onLinked();
      } catch (reason) {
        setError(`Product linked, but refreshing the item failed: ${errorText(reason)}`);
        return;
      }
      if (!result.imageError) onClose();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      busy.current = false;
      if (mounted.current) setLinking(false);
    }
  }

  return <Dialog open onOpenChange={(_, data) => { if (!data.open && !busy.current) onClose(); }}>
    <DialogSurface>
      <DialogBody>
        <DialogTitle>Scan Product Barcode</DialogTitle>
        <DialogContent className={styles.content}>
          <video ref={setVideo} autoPlay playsInline muted className={styles.video} aria-label="Barcode camera" />
          <Body1>Scan with your camera, or type a barcode below.</Body1>
          {cameraError && <MessageBar intent="warning"><MessageBarBody>
            Camera unavailable: {cameraError}. Type the barcode instead.
          </MessageBarBody></MessageBar>}
          <Field label="Barcode" required>
            <div className={styles.row}>
              <div className={styles.input}>
                <TextField context={context} parameters={{ value: { raw: barcode } }}
                  onNotifyOutputChanged={outputs => { if ((outputs.value ?? "") !== barcode) changeBarcode(outputs.value ?? ""); }}
                  onOverrideComponentProps={props => ({
                    ...props, id: "scan-barcode-input", "aria-label": "Barcode",
                    "data-testid": "scan-ean-input", disabled: linking || linked,
                    onChange: (event, value) => {
                      props.onChange?.(event, value);
                      changeBarcode(value ?? "");
                    },
                  })} />
              </div>
              <Button disabled={!barcode.trim() || looking || linking || linked}
                data-testid="scan-lookup-button" onClick={() => void lookUp(barcode)}>
                {looking ? <Spinner size="tiny" /> : "Look Up"}
              </Button>
            </div>
          </Field>
          {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          {imageError && <MessageBar intent="warning"><MessageBarBody>{imageError}</MessageBarBody></MessageBar>}
          {preview && <Card>
            {image && <img src={image} alt={preview.product.name || preview.barcode} className={styles.image}
              onError={() => { setImage(undefined); setImageError("The product image could not be displayed."); }} />}
            <Subtitle2 data-testid="scan-product-name">{preview.product.name || preview.barcode}</Subtitle2>
            <Body1>{[preview.product.brand, preview.product.quantity].filter(Boolean).join(" - ")}</Body1>
          </Card>}
        </DialogContent>
        <DialogActions>
          <Button disabled={linking} onClick={onClose}>{linked ? "Close" : "Cancel"}</Button>
          <Button appearance="primary" disabled={!preview || looking || linking || linked} onClick={() => void link()}
            data-testid="scan-link-button">{linking ? <Spinner size="tiny" /> : "Link to Item"}</Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
