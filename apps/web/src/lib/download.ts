// Revoking the URL during the click can cancel the download in some browsers; the files are small, so a generous delay is cheap.
const REVOKE_DELAY_MS = 10_000;

export function saveFile(bytes: Uint8Array<ArrayBuffer>, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
