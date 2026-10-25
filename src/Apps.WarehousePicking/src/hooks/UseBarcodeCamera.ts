import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { errorText } from "@/utils/ServicePayload";

export function useBarcodeCamera(video: HTMLVideoElement | null, active: boolean, onDetected: (value: string) => void) {
  const detected = useRef(onDetected);
  detected.current = onDetected;
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!active || !video) return;
    let disposed = false;
    let finished = false;
    let controls: IScannerControls | undefined;
    video.muted = true;
    new BrowserMultiFormatReader().decodeFromConstraints(
      { video: { facingMode: { ideal: "environment" } }, audio: false },
      video,
      (result, _error, scanner) => {
        controls = scanner;
        const text = result?.getText().trim();
        if (disposed || finished || !text || !/^\d+$/.test(text)) return;
        finished = true;
        scanner.stop();
        detected.current(text);
      },
    ).then(scanner => {
      controls = scanner;
      if (disposed || finished) scanner.stop();
    }).catch(reason => {
      if (!disposed) setError(errorText(reason));
    });
    return () => {
      disposed = true;
      controls?.stop();
      const stream = video.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    };
  }, [active, video]);
  return error;
}
