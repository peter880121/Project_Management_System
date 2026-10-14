"use client";

import { forwardRef } from "react";

export const FormMessage = forwardRef<HTMLDivElement, { message: string; kind?: "error" | "success" }>(
  function FormMessage({ message, kind = "error" }, ref) {
    return <div ref={ref} tabIndex={-1} role={kind === "error" ? "alert" : "status"}
      className={`rounded-md p-3 text-sm ${kind === "error" ? "bg-red-50 text-red-800" : "bg-teal-50 text-teal-800"}`}>{message}</div>;
  },
);
