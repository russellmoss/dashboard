'use client';

import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AdvisorLocation } from '@/lib/queries/advisor-locations';
import { formatDate } from '@/lib/utils/format-helpers';

// Fix for default marker icons in Leaflet with webpack
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Rooftop accuracy = blue marker
const rooftopIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// City-level accuracy = orange marker
const approximateIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

L.Marker.prototype.options.icon = defaultIcon;

interface AdvisorMapClientProps {
  advisors: AdvisorLocation[];
  onAdvisorClick?: (advisor: AdvisorLocation) => void;
  onViewDetails?: (primaryKey: string) => void;
}

// Component to auto-fit bounds to markers
function FitBounds({ advisors }: { advisors: AdvisorLocation[] }) {
  const map = useMap();

  useEffect(() => {
    const validAdvisors = advisors.filter(a => a.lat !== null && a.lng !== null);
    if (validAdvisors.length > 0) {
      const bounds = L.latLngBounds(
        validAdvisors.map(a => [a.lat!, a.lng!] as [number, number])
      );
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [advisors, map]);

  return null;
}

function getMarkerIcon(advisor: AdvisorLocation): L.Icon {
  if (advisor.geocodeAccuracy === 'ROOFTOP' || advisor.geocodeAccuracy === 'RANGE_INTERPOLATED') {
    return rooftopIcon;
  }
  return approximateIcon;
}

function formatCurrency(value: number | null): string {
  if (value === null) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function AdvisorMapClient({ advisors, onAdvisorClick, onViewDetails }: AdvisorMapClientProps) {
  const validAdvisors = useMemo(
    () => advisors.filter(a => a.lat !== null && a.lng !== null),
    [advisors]
  );

  // Default center: continental US
  const defaultCenter: [number, number] = [39.8283, -98.5795];
  const defaultZoom = 4;

  if (validAdvisors.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800 rounded-lg">
        <p className="text-gray-500 dark:text-gray-400">No advisors with coordinates to display</p>
      </div>
    );
  }

  return (
    <MapContainer
      center={defaultCenter}
      zoom={defaultZoom}
      className="h-full w-full rounded-lg"
      style={{ minHeight: '500px' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds advisors={validAdvisors} />
      {validAdvisors.map((advisor) => (
        <Marker
          key={advisor.primaryKey}
          position={[advisor.lat!, advisor.lng!]}
          icon={getMarkerIcon(advisor)}
          eventHandlers={{
            click: () => onAdvisorClick?.(advisor),
          }}
        >
          <Popup>
            <div className="min-w-[200px]">
              <h3 className="font-semibold text-gray-900 mb-2">{advisor.advisorName}</h3>
              <div className="space-y-1 text-sm text-gray-600">
                {/* Full address if street is available, otherwise just city/state */}
                {advisor.street1 ? (
                  <div>
                    <span className="font-medium">Address:</span>
                    <div className="ml-2">
                      <p>{advisor.street1}</p>
                      {advisor.street2 && <p>{advisor.street2}</p>}
                      <p>
                        {[advisor.city, advisor.state].filter(Boolean).join(', ')}
                        {advisor.postalCode && ` ${advisor.postalCode}`}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p>
                    <span className="font-medium">Location:</span>{' '}
                    {[advisor.city, advisor.state].filter(Boolean).join(', ') || 'Unknown'}
                  </p>
                )}
                {advisor.joinDate && (
                  <p>
                    <span className="font-medium">Joined:</span> {formatDate(advisor.joinDate)}
                  </p>
                )}
                {advisor.aum !== null && (
                  <p>
                    <span className="font-medium">AUM:</span> {formatCurrency(advisor.aum)}
                  </p>
                )}
                {advisor.sgaOwner && (
                  <p>
                    <span className="font-medium">SGA:</span> {advisor.sgaOwner}
                  </p>
                )}
                {advisor.sgmOwner && (
                  <p>
                    <span className="font-medium">SGM:</span> {advisor.sgmOwner}
                  </p>
                )}
                {advisor.channel && (
                  <p>
                    <span className="font-medium">Channel:</span> {advisor.channel}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  {advisor.geocodeAccuracy === 'ROOFTOP' ? 'Street-level accuracy' : 'City-level accuracy'}
                </p>
                {onViewDetails && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewDetails(advisor.primaryKey);
                    }}
                    className="mt-3 w-full px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                  >
                    View Full Details
                  </button>
                )}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
