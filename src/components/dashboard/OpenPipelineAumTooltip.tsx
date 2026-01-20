'use client';

import { InfoTooltip } from '@/components/ui/InfoTooltip';

export function OpenPipelineAumTooltip() {
  return (
    <InfoTooltip
      content={
        <div className="space-y-2">
          <p className="font-semibold text-white">How Open Pipeline AUM is Calculated</p>
          
          <div className="space-y-1.5 text-gray-200 text-xs">
            <p>
              <span className="font-medium text-white">AUM Value:</span> Uses{' '}
              <span className="font-mono bg-gray-800 px-1 rounded">Underwritten AUM</span> 
              {' '}if available, otherwise falls back to{' '}
              <span className="font-mono bg-gray-800 px-1 rounded">Amount</span> on the Opportunity.
            </p>
            
            <p>
              <span className="font-medium text-white">Record Type:</span> Only includes{' '}
              <span className="text-blue-300">Recruiting</span> opportunities
              (real pipeline opportunities, not Re-Engagement attempts).
            </p>
            
            <p>
              <span className="font-medium text-white">Included Stages:</span>
            </p>
            <ul className="list-disc list-inside pl-2 text-green-300">
              <li>Qualifying</li>
              <li>Discovery</li>
              <li>Sales Process</li>
              <li>Negotiating</li>
            </ul>
            
            <p>
              <span className="font-medium text-white">Excluded Stages:</span>
            </p>
            <ul className="list-disc list-inside pl-2 text-red-300">
              <li>Closed Lost</li>
              <li>Joined</li>
              <li>On Hold</li>
              <li>Signed</li>
            </ul>
            
            <p className="text-yellow-200 pt-1 border-t border-gray-700">
              <span className="font-medium">Note:</span> This is a real-time snapshot 
              of current pipeline—not filtered by the date range selected above.
            </p>
          </div>
        </div>
      }
    />
  );
}
