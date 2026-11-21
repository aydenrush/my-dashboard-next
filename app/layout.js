import "./globals.css";
import Sidebar from "@/components/Sidebar";
import DbStatus from "@/components/DbStatus";

export const metadata = {
  title: "Dashboard",
  description: "Personal dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="app-layout">
          <Sidebar />
          <main className="main-content">{children}</main>
          <DbStatus />
        </div>
      </body>
    </html>
  );
}
