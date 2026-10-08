/** Wer angemeldet ist, aus `GET /api/auth/ich`. */
export interface Ich {
  id: string;
  name: string;
  email: string;
  /** `kiosk` ist das Selbstbedienungs-Tablet am Stand, siehe `kiosk/Kiosk.tsx`. */
  rolle: "admin" | "betreuer" | "kiosk";
  /** Leer heisst: noch nicht gesetzt, dann zeigt die Oberflaeche "NAMUR HV 2026". */
  appName: string;
  /** Mit abschliessendem Schraegstrich. Die GUID wird angehaengt. */
  viewerBaseUrl: string;
}
