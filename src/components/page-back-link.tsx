import Link from "next/link";

export function PageBackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <div className="mb-6"><Link href={href} className="text-link inline-flex items-center text-sm font-medium text-teal-800 hover:underline">{children}</Link></div>;
}
