import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "./ui/button";

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  const label = typeof children === "string" ? children.replace(/^\s*←\s*/, "") : children;
  return <Link href={href} data-ui-button="true" data-page-back="true" className={buttonVariants({ variant: "outline" })}><ArrowLeft aria-hidden="true" className="size-4" />{label}</Link>;
}
export function PageBackLink(props: { href: string; children: React.ReactNode }) {
  return <div className="mb-5 flex min-h-10 items-start"><BackLink {...props} /></div>;
}
