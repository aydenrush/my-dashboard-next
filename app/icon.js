import { ImageResponse } from "next/og";

// app icon (browser tab + Android home screen via the manifest), drawn in code so there is no image file to keep in sync
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#3b82f6", color: "white", fontSize: 317, fontWeight: 800, borderRadius: "22%" }}>
        D
      </div>
    ),
    { ...size }
  );
}
