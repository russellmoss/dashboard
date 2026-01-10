'use client';

import { Button } from '@tremor/react';
import { Download } from 'lucide-react';
import { exportToCSV } from '@/lib/utils/export-csv';

interface ExportButtonProps {
  data: any[];
  filename: string;
}

export function ExportButton({ data, filename }: ExportButtonProps) {
  const handleExport = () => {
    if (data.length === 0) {
      alert('No data to export');
      return;
    }
    exportToCSV(data, filename);
  };

  return (
    <Button
      icon={Download}
      size="sm"
      variant="secondary"
      onClick={handleExport}
      disabled={data.length === 0}
    >
      Export CSV
    </Button>
  );
}
