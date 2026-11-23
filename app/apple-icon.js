import { ImageResponse } from "next/og";

// iPhone home-screen icon, drawn in code so there is no image file to keep in sync
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#3b82f6", color: "white", fontSize: 112, fontWeight: 800, borderRadius: 0 }}>
        D
      </div>
    ),
    { ...size }
  );
}
