import type { IOperationResult } from "@microsoft/power-apps/data";

export function errorText(error: unknown): string {
  if (error instanceof Error) return serverMessage(error.message);
  if (typeof error === "string") return serverMessage(error);
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return serverMessage(error.message);
  }
  console.error("Unexpected service error", error);
  return "The request failed.";
}

function serverMessage(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
      return body.message;
    }
    if (body && typeof body === "object" && "error" in body) {
      const error = body.error;
      if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
        return error.message;
      }
    }
  } catch {
    // A plain server message is already the display text.
  }
  return text;
}

export async function serviceResult<T>(call: Promise<IOperationResult<T>>): Promise<IOperationResult<T>> {
  const result = await call;
  if (!result.success) {
    throw new Error(errorText(result.error ?? "The request failed."));
  }
  return result;
}

export async function serviceData<T>(call: Promise<IOperationResult<T>>): Promise<T> {
  const result = await serviceResult(call);
  if (result.data === undefined || result.data === null) {
    throw new Error("The service returned no data.");
  }
  return result.data;
}
