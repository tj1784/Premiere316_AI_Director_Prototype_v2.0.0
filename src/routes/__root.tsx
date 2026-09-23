import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";
import { useEffect } from "react";

const APP_NAME = "Premiere316";

function DesktopWindowStyle() {
  useEffect(() => {
    if (!window.premiere316?.isDesktop) return;
    document.documentElement.classList.add("premiere-desktop");
    return () => document.documentElement.classList.remove("premiere-desktop");
  }, []);
  return null;
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content: "Premiere316 V3.02 — a standalone picture factory. Screenplay to stitch, no ComfyUI.",
      },
      { name: "theme-color", content: "#09090b" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg">
        <DesktopWindowStyle />
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#1a1a1e",
              color: "#efe8dc",
              border: "1px solid rgba(239,232,220,0.12)",
              fontFamily: '"Segoe UI Variable Text", "Segoe UI", sans-serif',
              fontWeight: 300,
            },
          }}
        />
        <Scripts />
      </body>
    </html>
  ),
});
