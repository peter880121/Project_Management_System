import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-teal-800 bg-teal-800 text-white shadow-sm hover:border-teal-900 hover:bg-teal-900",
        secondary: "border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200",
        outline: "border-slate-200 bg-white text-slate-600 shadow-sm hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900",
        ghost: "border-transparent bg-transparent text-slate-600 shadow-none hover:bg-slate-100",
        destructive: "border-red-700 bg-red-700 text-white shadow-sm hover:border-red-800 hover:bg-red-800",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3 text-xs",
        lg: "h-11 px-6",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button data-ui-button="true" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
