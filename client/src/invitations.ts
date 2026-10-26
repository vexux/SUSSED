import QRCode from "qrcode";

export type InvitationCodeResult =
  | { status: "missing"; code: null }
  | { status: "invalid"; code: null }
  | { status: "valid"; code: string };

export function normalizeInvitationCode(value: string): string {
  return value.trim().toUpperCase();
}

export function parseInvitationCode(search: string): InvitationCodeResult {
  const values = new URLSearchParams(search).getAll("code");
  if (values.length === 0) return { status: "missing", code: null };
  if (values.length !== 1) return { status: "invalid", code: null };
  const code = normalizeInvitationCode(values[0] ?? "");
  return /^[A-Z]{4}$/u.test(code)
    ? { status: "valid", code }
    : { status: "invalid", code: null };
}

export function preserveInvitationCode(
  redirectUrl: string,
  currentOrigin: string,
  invitation: InvitationCodeResult,
): string {
  if (invitation.status !== "valid") return redirectUrl;
  const target = new URL(redirectUrl, currentOrigin);
  target.searchParams.set("code", invitation.code);
  return target.toString();
}

export function createInvitationUrl(
  roomCode: string,
  currentHref: string,
  configuredPublicOrigin?: string,
): string {
  const code = normalizeInvitationCode(roomCode);
  if (!/^[A-Z]{4}$/u.test(code)) throw new Error("A valid four-letter room code is required.");

  const current = new URL(currentHref);
  const publicOrigin = configuredPublicOrigin?.trim();
  const target = new URL(publicOrigin || current.origin);
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new Error("The public frontend URL must use HTTP or HTTPS.");
  }
  if (target.pathname !== "/" || target.search || target.hash) {
    throw new Error("VITE_PUBLIC_APP_URL must contain only the public frontend origin.");
  }

  target.searchParams.set("code", code);
  return target.toString();
}

export function createInvitationQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 256,
  });
}

export interface ClipboardFallbacks {
  writeText?: (text: string) => Promise<void>;
  fallbackCopy: (text: string) => boolean | Promise<boolean>;
}

export async function copyText(text: string, options: ClipboardFallbacks): Promise<void> {
  if (options.writeText) {
    try {
      await options.writeText(text);
      return;
    } catch {
      // Clipboard permissions can be denied; use the browser copy fallback.
    }
  }
  if (!(await options.fallbackCopy(text))) throw new Error("Copying to the clipboard failed.");
}

export async function shareOrCopyInvitation(
  invitation: { title: string; text: string; url: string },
  options: {
    share?: (data: { title: string; text: string; url: string }) => Promise<void>;
    copy: (text: string) => Promise<void>;
  },
): Promise<"shared" | "copied"> {
  if (options.share) {
    try {
      await options.share(invitation);
      return "shared";
    } catch {
      // Native sharing can be unavailable or rejected; copy the same link.
    }
  }
  await options.copy(invitation.url);
  return "copied";
}
