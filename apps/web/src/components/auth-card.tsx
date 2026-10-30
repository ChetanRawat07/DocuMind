import type { ReactNode } from 'react';
import { BrandMark } from './ui/brand-mark';
import { Card } from './ui/card';

/** Centered card for the signed-out pages. */
export function AuthCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <title>{`${title} · DocuMind`}</title>
      <div className="w-full max-w-sm">
        <BrandMark className="mb-8 justify-center text-lg" />
        <Card className="p-6 sm:p-8">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          <div className="mt-6">{children}</div>
        </Card>
        {footer ? <div className="mt-5 text-center text-sm text-gray-600">{footer}</div> : null}
      </div>
    </main>
  );
}
