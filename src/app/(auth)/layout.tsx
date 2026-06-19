import Link from "next/link";

import { Logo } from "@/components/ui/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-aurora">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-12">
        <Link href="/" className="mx-auto mb-8">
          <Logo />
        </Link>
        {children}
      </div>
    </div>
  );
}
