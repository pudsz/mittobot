import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query";
import { AuthProvider } from "@/hooks/useAuth";
import { ConfirmProvider } from "@/components/app/ConfirmProvider";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ConfirmProvider>
            <App />
            <Toaster
              position="bottom-center"
              toastOptions={{
                style: {
                  background: "oklch(0.205 0 0)",
                  color: "oklch(0.985 0 0)",
                  border: "1px solid oklch(0.269 0 0)",
                  borderRadius: "8px",
                  fontSize: "14px",
                  padding: "10px 16px",
                },
                duration: 2500,
              }}
            />
          </ConfirmProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
