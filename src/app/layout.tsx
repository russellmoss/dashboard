import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { SessionProviderWrapper } from '@/components/providers/SessionProviderWrapper';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Savvy Analytics - Funnel Dashboard',
  description: 'Funnel performance analytics dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-gray-50 dark:bg-gray-900 transition-colors`}>
        <SessionProviderWrapper>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
