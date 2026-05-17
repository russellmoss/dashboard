'use client';

import { useState } from 'react';
import { PlayCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface TutorialVideo {
  id: string;
  title: string;
  description: string;
  driveFileId: string;
  roles: string[];
}

const TUTORIALS: TutorialVideo[] = [
  {
    id: 'sga-kixie-notes',
    title: 'SGA: Kixie Call Notes & Advisor Handoff',
    description:
      'Learn how your Kixie call notes flow into the system, how to review and approve them, push notes to Salesforce, and how the Advisor Notes handoff document is automatically created for your SGM.',
    driveFileId: '1ze3rAYlfvnuW6wUbAc7BJ1AFLpJc_HBo',
    roles: ['sga'],
  },
  {
    id: 'sgm-granola-notes',
    title: 'SGM: Granola Call Notes & Salesforce',
    description:
      'See how your Granola meeting notes are captured and delivered for your approval, how to push them into Salesforce to create a definitive link to the record, and how that sets you up for call coaching later.',
    driveFileId: '1I0Vig2H3bCDh0yC0gRlaghyfOaUMOydY',
    roles: ['sgm'],
  },
  {
    id: 'sgm-record-linking',
    title: 'SGM: Linking a Call to the Right Record',
    description:
      'When a Granola call can\'t automatically find the right Salesforce record, this video walks you through how to manually link the call to the correct opportunity.',
    driveFileId: '17CUu-rZ8mAlKJE-QHRDlbrPlCrF4fnbj',
    roles: ['sgm'],
  },
  {
    id: 'sgm-opportunity-features',
    title: 'SGM: Opportunity Views, Chat & Action Plans',
    description:
      'Explore the opportunity detail view — see AI summaries across all calls with an opportunity, chat with your notes and transcripts, and create next-call action plans to prepare for upcoming meetings.',
    driveFileId: '14AjmQ4kd9Is2ooCf8gGn88sGFIROzHjz',
    roles: ['sgm'],
  },
];

function rolesForUser(role: string): string[] {
  if (role === 'admin' || role === 'revops_admin' || role === 'manager') {
    return ['sga', 'sgm'];
  }
  return [role];
}

interface Props {
  role: string;
}

export default function TutorialsTab({ role }: Props) {
  const visibleRoles = rolesForUser(role);
  const videos = TUTORIALS.filter((v) => v.roles.some((r) => visibleRoles.includes(r)));
  const [expandedId, setExpandedId] = useState<string | null>(videos[0]?.id ?? null);

  const sgaVideos = videos.filter((v) => v.roles.includes('sga'));
  const sgmVideos = videos.filter((v) => v.roles.includes('sgm'));
  const showSections = sgaVideos.length > 0 && sgmVideos.length > 0;

  return (
    <div className="space-y-6 py-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Video Tutorials
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Watch these videos to learn how to use the Call Intelligence system.
          Click a video to expand and play.
        </p>
      </div>

      {showSections ? (
        <>
          {sgaVideos.length > 0 && (
            <VideoSection
              title="For SGAs"
              videos={sgaVideos}
              expandedId={expandedId}
              onToggle={setExpandedId}
            />
          )}
          {sgmVideos.length > 0 && (
            <VideoSection
              title="For SGMs"
              videos={sgmVideos}
              expandedId={expandedId}
              onToggle={setExpandedId}
            />
          )}
        </>
      ) : (
        <div className="space-y-3">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              expanded={expandedId === video.id}
              onToggle={() =>
                setExpandedId(expandedId === video.id ? null : video.id)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VideoSection({
  title,
  videos,
  expandedId,
  onToggle,
}: {
  title: string;
  videos: TutorialVideo[];
  expandedId: string | null;
  onToggle: (id: string | null) => void;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3">
        {title}
      </h3>
      <div className="space-y-3">
        {videos.map((video) => (
          <VideoCard
            key={video.id}
            video={video}
            expanded={expandedId === video.id}
            onToggle={() =>
              onToggle(expandedId === video.id ? null : video.id)
            }
          />
        ))}
      </div>
    </div>
  );
}

function VideoCard({
  video,
  expanded,
  onToggle,
}: {
  video: TutorialVideo;
  expanded: boolean;
  onToggle: () => void;
}) {
  const embedUrl = `https://drive.google.com/file/d/${video.driveFileId}/preview`;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
      >
        <PlayCircle className="w-5 h-5 text-blue-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {video.title}
          </p>
          {!expanded && (
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
              {video.description}
            </p>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
            {video.description}
          </p>
          <div className="relative w-full rounded-lg overflow-hidden bg-black" style={{ paddingBottom: '56.25%' }}>
            <iframe
              src={embedUrl}
              className="absolute inset-0 w-full h-full"
              allow="autoplay; encrypted-media"
              allowFullScreen
              title={video.title}
            />
          </div>
        </div>
      )}
    </div>
  );
}
