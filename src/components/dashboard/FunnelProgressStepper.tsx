// src/components/dashboard/FunnelProgressStepper.tsx

'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { FunnelStageFlags } from '@/types/record-detail';

interface FunnelProgressStepperProps {
  flags: FunnelStageFlags;
  tofStage: string;
}

interface Stage {
  key: keyof FunnelStageFlags;
  label: string;
  shortLabel: string;
}

const STAGES: Stage[] = [
  { key: 'isContacted', label: 'Contacted', shortLabel: 'Contacted' },
  { key: 'isMql', label: 'MQL', shortLabel: 'MQL' },
  { key: 'isSql', label: 'SQL', shortLabel: 'SQL' },
  { key: 'isSqo', label: 'SQO', shortLabel: 'SQO' },
  { key: 'isJoined', label: 'Joined', shortLabel: 'Joined' },
];

export function FunnelProgressStepper({ flags, tofStage }: FunnelProgressStepperProps) {
  // Determine current stage index based on TOF_Stage
  const getCurrentStageIndex = (): number => {
    const stageMap: Record<string, number> = {
      'Prospect': -1,
      'Contacted': 0,
      'MQL': 1,
      'SQL': 2,
      'SQO': 3,
      'Joined': 4,
    };
    return stageMap[tofStage] ?? -1;
  };

  const currentStageIndex = getCurrentStageIndex();

  return (
    <div className="w-full py-4">
      <div className="flex items-center justify-between">
        {STAGES.map((stage, index) => {
          const isCompleted = flags[stage.key];
          const isCurrent = index === currentStageIndex;
          const isFuture = index > currentStageIndex;

          return (
            <React.Fragment key={stage.key}>
              {/* Stage indicator */}
              <div className="flex flex-col items-center">
                <div
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center
                    transition-all duration-200
                    ${isCompleted 
                      ? 'bg-green-500 text-white' 
                      : isCurrent 
                        ? 'bg-blue-500 text-white ring-4 ring-blue-200 dark:ring-blue-800' 
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                    }
                  `}
                >
                  {isCompleted ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <span className="w-3 h-3 rounded-full bg-current" />
                  )}
                </div>
                <span 
                  className={`
                    mt-2 text-xs font-medium
                    ${isCompleted 
                      ? 'text-green-600 dark:text-green-400' 
                      : isCurrent 
                        ? 'text-blue-600 dark:text-blue-400' 
                        : 'text-gray-400 dark:text-gray-500'
                    }
                  `}
                >
                  {stage.shortLabel}
                </span>
              </div>

              {/* Connector line */}
              {index < STAGES.length - 1 && (
                <div 
                  className={`
                    flex-1 h-1 mx-2
                    ${flags[STAGES[index + 1].key] || (index < currentStageIndex)
                      ? 'bg-green-500' 
                      : 'bg-gray-200 dark:bg-gray-700'
                    }
                  `}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default FunnelProgressStepper;
