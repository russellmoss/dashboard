import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SessionProviderWrapper } from '@/components/providers/SessionProviderWrapper';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Savvy GTM Dashboard',
  description: 'GTM Analytics Dashboard',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="overflow-x-hidden">
      <body className={`${inter.className} bg-gray-50 dark:bg-gray-900 transition-colors overflow-x-hidden`}>
        <SessionProviderWrapper>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </SessionProviderWrapper>
        <Analytics />
      </body>
    </html>
  );
}
