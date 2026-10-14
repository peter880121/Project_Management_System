"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

export const FormField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & {
  id: string; label: string; error?: string; help?: string;
}>(function FormField({ id, label, error, help, ...props }, ref) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium">{label}</label>
      <input {...props} ref={ref} id={id} aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
        className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:opacity-60" />
      {help && <p id={`${id}-help`} className="mt-1 text-sm text-slate-600">{help}</p>}
      {error && <p id={`${id}-error`} className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
});
