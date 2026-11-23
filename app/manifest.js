// lets "Add to Home Screen" install the dashboard like an app (own icon, no browser bars)
export default function manifest() {
  return {
    name: "Dashboard",
    short_name: "Dashboard",
    description: "Personal dashboard",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" }],
  };
}
